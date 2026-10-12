/* Enterprise Clinical Copilot — the answer surface.

   Submits the composer's intent, relays the agent's progress stages as they
   arrive, and mounts the agent's A2UI surface when the answer lands.

   Plain JavaScript, for the same reason the composer is: the component framework
   in this project belongs to the A2UI renderer. The renderer is still what draws
   the answer — but it is fetched on demand, only when there is a surface to
   draw, because its module graph is large and nothing on first paint needs it.
   `import()` works from a classic script, so this needs no build step.

   The answer arrives complete, in one frame. That is the server's decision, not
   this file's: the guardrails rewrite the model's text after it finishes, so a
   token stream would show text that is then corrected. What streams is progress.

   Submitting moves the canvas into its conversation state — the mark to the head,
   the question into the box beneath it, the run into the row below that, and the
   composer to the foot — by adding one class and letting the stylesheet do the
   rest. The move is one way: nothing here puts the canvas back. */
(function () {
  'use strict';

  var shell = document.getElementById('copilot-shell');
  var form = document.getElementById('cp-ask');
  var answer = document.getElementById('cp-answer');
  var question = document.getElementById('cp-question');
  var questionText = document.getElementById('cp-question-text');
  var status = document.getElementById('cp-status');
  var statusRow = document.getElementById('cp-status-toggle');
  var statusText = document.getElementById('cp-status-text');
  var stageList = document.getElementById('cp-stages');
  var canvas = document.getElementById('cp-canvas');
  var text = document.getElementById('cp-answer-text');
  var patientField = document.getElementById('cp-patient-id');
  var intentField = document.getElementById('cp-command-intent');
  var input = document.getElementById('cp-ask-input');
  var remaining = document.getElementById('remaining');
  if (!shell || !form || !answer || !stageList || !canvas || !text) return;
  if (!question || !questionText || !status || !statusRow || !statusText) return;

  var askUrl = shell.getAttribute('data-ask-url');
  var rendererUrl = canvas.getAttribute('data-renderer-url');
  if (!askUrl) return;

  var renderer = null;      // resolved on the first answer, then reused
  var inFlight = false;
  var answerPayload = null;

  function csrfToken() {
    var field = form.querySelector('[name=csrfmiddlewaretoken]');
    return field ? field.value : '';
  }

  /* A new question clears the answer that belonged to the last one: the span, the
     canvas, the prose. The question box and the status row are the caller's to
     replace, because they describe the run rather than its result. */
  function resetAnswer() {
    stageList.textContent = '';
    text.textContent = '';
    text.classList.remove('cp-answer-error');
    canvas.textContent = '';
    answerPayload = null;
    answer.hidden = false;
  }

  /* What was asked, in the terms it was asked in: the patient and the command
     chosen in the composer, plus anything typed alongside them. The composer keeps
     its pills, so this is a record of the request rather than a copy of the
     controls that made it. */
  function askedFor() {
    var parts = [];
    var patient = document.getElementById('cp-patient-label');
    var command = document.getElementById('cp-command-label');
    var typed = document.getElementById('cp-ask-input');
    if (patient && patient.textContent.trim()) parts.push(patient.textContent.trim());
    if (command && command.textContent.trim()) parts.push(command.textContent.trim());
    if (typed && typed.value.trim()) parts.push(typed.value.trim());
    return parts.join(' - ');
  }

  function showQuestion() {
    var asked = askedFor();
    if (!asked) return;
    questionText.textContent = asked;
    question.hidden = false;
  }

  /* The run is over, whether it produced an answer or gave up. The dots stop, and
     the caret appears, because there is now a span behind it worth opening. */
  function finishRun() {
    if (!status) return;
    status.classList.add('is-done');
    statusRow.disabled = false;
  }

  function say(message, isError) {
    text.textContent = message;
    if (isError) text.classList.add('cp-answer-error');
  }

  /* A stage does two things: it becomes the row the reader is looking at, and it
     takes its place in the span behind the caret. The row is replaced rather than
     appended, so the run reads as movement; the list keeps every stage, because
     that is what the caret is for. */
  function stage(label) {
    var item = document.createElement('li');
    item.className = 'cp-stage';
    item.textContent = label;
    stageList.appendChild(item);

    if (label === statusText.textContent) return;
    statusText.textContent = label;
    // Restart the fade, so a replaced stage reads as replaced even when the two
    // arrive a moment apart.
    statusText.style.animation = 'none';
    void statusText.offsetWidth;
    statusText.style.animation = '';
  }

  async function scene() {
    if (!renderer) {
      if (!rendererUrl) throw new Error('no renderer url');
      var module = await import(rendererUrl);
      // The markdown provider has to sit above the surface: the basic Text
      // component renders Markdown, and without it the answer arrives as raw.
      new module.ContextProvider(canvas, {
        context: module.Context.markdown, initialValue: module.renderMarkdown,
      });
      renderer = {
        MessageProcessor: module.MessageProcessor,
        catalog: module.buildRiskCatalog(module.basicCatalog),
      };
    }
    return renderer;
  }

  async function draw(envelope) {
    if (!envelope || !envelope.messages) return;
    var sceneRenderer = await scene();
    // A fresh processor per answer: reusing one would carry the previous
    // surface into the new one and draw both.
    var processor = new sceneRenderer.MessageProcessor([sceneRenderer.catalog]);
    processor.onSurfaceCreated(function (surface) {
      var element = document.createElement('a2ui-surface');
      element.surface = surface;
      canvas.appendChild(element);
    });
    processor.processMessages(envelope.messages);
  }

  /* ---------------- the stream ---------------- */

  function receive(name, payload) {
    if (name === 'answer') {
      answerPayload = payload;
      finishRun();
      return;
    }
    if (name === 'error') {
      // The error frame carries the same shape as the blocking path's 502 body,
      // quota figure included, so a streamed failure leaves the same state
      // behind as one that never became a stream.
      if (remaining && payload.remaining !== undefined) {
        remaining.textContent = payload.remaining;
      }
      finishRun();
      say(payload.error || 'The clinical copilot is unavailable. Please try again.', true);
      return;
    }
    // A stage frame's own wording, whatever the agent chose to call it.
    var label = payload.label || payload.stage || name;
    if (label) stage(label);
  }

  function handleBlock(block) {
    var name = '';
    var data = '';
    block.split('\n').forEach(function (line) {
      if (line.indexOf('event:') === 0) name = line.slice(6).trim();
      else if (line.indexOf('data:') === 0) data += line.slice(5).trim();
    });
    if (!data) return;
    try {
      receive(name, JSON.parse(data));
    } catch (error) {
      // A frame that will not parse is not worth failing the answer over.
    }
  }

  async function consume(body) {
    var reader = body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    for (;;) {
      var step = await reader.read();
      if (step.done) break;
      buffer += decoder.decode(step.value, { stream: true });
      // Split on the blank line that ends a frame, rather than assuming one
      // chunk is one frame: a chunk boundary can fall anywhere.
      var boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        handleBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
    }
    if (buffer.trim()) handleBlock(buffer);
  }

  /* The caret opens the span: every stage the run passed through, in order. */
  statusRow.addEventListener('click', function () {
    if (statusRow.disabled) return;
    var open = statusRow.getAttribute('aria-expanded') === 'true';
    statusRow.setAttribute('aria-expanded', open ? 'false' : 'true');
    stageList.hidden = open;
  });

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (inFlight) return;

    var hadmId = patientField ? patientField.value : '';
    if (!hadmId) {
      resetAnswer();
      say('Choose a patient first — type @ and a name.');
      return;
    }

    var request = { hadm_id: Number(hadmId) };

    // A `/` command names which question to ask, and the typed text is either
    // that command's own input or a separate question. Which one it is belongs to
    // the agent, which owns the command vocabulary; deciding here would be a
    // second copy of that table, and the copy is what gets it wrong. So both are
    // sent when the composer holds both, and the answer is a refusal when the two
    // do not belong together (ECC-22).
    var intent = intentField ? intentField.value : '';
    var asked = input ? input.value.trim() : '';
    if (intent) request.chip = intent;
    if (asked) request.question = asked;

    inFlight = true;
    // One way: the canvas does not return to its empty state between questions.
    // The mark stays at the head and the composer at the foot for the rest of the
    // page's life.
    shell.classList.add('is-asking');
    resetAnswer();
    showQuestion();
    // The patient pill stays: the admission is what the next question is about.
    // The command and the typed text do not — both belong to the question just
    // asked. A command left pinned would make the next typed question arrive as a
    // command AND a question, which the server refuses as two intentions rather
    // than resolving quietly (ECC-22); and text left in the box would be sent
    // again by the next submit.
    // Both are cleared after showQuestion, which reads them to echo what was asked.
    form.dispatchEvent(new CustomEvent('cp:command-consumed'));
    if (input) {
      input.value = '';
      input.setSelectionRange(0, 0);
      input.focus();
    }
    status.hidden = false;
    status.classList.remove('is-done');
    statusRow.disabled = true;
    statusRow.setAttribute('aria-expanded', 'false');
    stageList.hidden = true;
    stage('Sending the question');

    try {
      var response = await fetch(askUrl, {
        method: 'POST',
        // `Accept` is what selects the streaming shape of the response. The
        // server relays the chain's progress stages only to a caller that asks
        // for an event stream; without this header it answers with a single
        // JSON object instead, which is a silent downgrade rather than an
        // error — the parser above then finds no frames in it and the answer is
        // discarded unread.
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'X-CSRFToken': csrfToken(),
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        var failure = await response.json().catch(function () { return {}; });
        say(failure.error || 'The clinical copilot is unavailable. Please try again.', true);
        return;
      }

      await consume(response.body);

      if (answerPayload) {
        if (remaining && answerPayload.remaining !== undefined) {
          remaining.textContent = answerPayload.remaining;
        }
        say(answerPayload.answer || '');
        // The composed surface is a bonus on top of the prose: if the renderer
        // cannot mount, the answer the clinician needs is already on screen.
        try {
          await draw(answerPayload.a2ui);
        } catch (error) {
          console.error('a2ui: the composed surface could not be drawn', error);
        }
      } else if (!text.textContent) {
        say('The clinical copilot is unavailable. Please try again.', true);
      }
    } catch (error) {
      say('The clinical copilot is unavailable. Please try again.', true);
    } finally {
      inFlight = false;
    }
  });
})();
