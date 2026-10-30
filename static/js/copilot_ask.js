/* Enterprise Clinical Copilot — one question over the wire, and the frames that come back.

   Everything here is transport: assembling the body the proxy accepts, sending it with
   the headers that select a stream, and parsing the frames that arrive. Nothing here
   touches the page. The turn hands in what to ask and a set of callbacks for what to do
   with an answer, a stage or a failure, and this module owns no DOM at all.

   The frame names are the proxy's: `answer` and `error` are terminal and exactly one of
   them always arrives; `answer_delta` carries prose as it is written; `prose_settled`
   says whether what was announced survived the guardrails; every other event is a
   progress stage whose label the agent chose. `tests/js/frames.test.mjs` holds this
   vocabulary against `demo/views.py` and `demo/ask/`, so a rename on either side fails
   there rather than here.

   Split out of `copilot_canvas.js` in Phase 5. */
(function () {
  'use strict';

  var UNAVAILABLE = 'The clinical copilot is unavailable. Please try again.';

  /* The body this proxy accepts, in the shape `demo/ask/intent.py` validates.

     `chip` and `question` can both be present: which commands take the caller's words is
     the agent's vocabulary to interpret, and deciding it here would be a second copy of
     that table. The two capabilities — `stream_prose` and `follow_ups` — are sent
     because this page draws both, and they are capabilities rather than intent. */
  function requestBody(request) {
    var fields = { hadm_id: Number(request.hadmId) };
    if (request.conversationId) fields.conversation_id = request.conversationId;
    // Sent as its own field rather than folded into the wording, because the agent is
    // the one place that defines this vocabulary.
    if (request.declared) fields.intent = request.declared;
    if (request.chip) fields.chip = request.chip;
    if (request.question) fields.question = request.question;
    // The heading is the words the reader saw, so the turn the store keeps is headed
    // with them. The server cannot reconstruct it: it is handed an intent, not the
    // vocabulary the console drew it from.
    fields.asked = request.asked;
    fields.stream_prose = true;
    fields.follow_ups = true;
    return fields;
  }

  /* The frames of one run, read in order.

     Split on the blank line that ends a frame rather than assuming one chunk is one
     frame: a chunk boundary can fall anywhere. */
  async function consume(stream, handlers) {
    var reader = stream.getReader();
    var decoder = new window.TextDecoder();
    var buffer = '';
    var answerPayload = null;
    var swap = null;

    function frame(raw) {
      var name = '';
      var data = '';
      raw.split('\n').forEach(function (line) {
        if (line.indexOf('event:') === 0) name = line.slice(6).trim();
        else if (line.indexOf('data:') === 0) data += line.slice(5).trim();
      });
      if (!data) return;
      var payload;
      try {
        payload = JSON.parse(data);
      } catch (error) {
        // A frame that will not parse is not worth failing the answer over.
        return;
      }

      if (name === 'answer') {
        answerPayload = payload;
        return;
      }
      if (name === 'answer_delta') {
        // The answer arriving early. Written straight into the turn's prose so it grows
        // in place; the settled answer replaces it wholesale when it lands, which is
        // what stops the two from interleaving.
        if (payload.text) handlers.prose(String(payload.text));
        return;
      }
      if (name === 'prose_settled') {
        // Sent only when what was announced did not survive into the answer. The
        // verdict is the server's to make and not this file's: the client can see that
        // the text moved, but only the process that ran the guardrails knows why.
        swap = payload.swap || null;
        return;
      }
      if (name === 'error') {
        // The error frame carries the same shape as the blocking path's 502 body,
        // quota figure included, so a streamed failure leaves the same state behind
        // as one that never became a stream.
        handlers.error(payload.error || UNAVAILABLE, payload.remaining);
        return;
      }
      // A stage frame's own wording, whatever the agent chose to call it. A stage that
      // arrives after this turn has already drawn prose is the run going back for
      // evidence, and the turn decides what to do about that.
      var label = payload.label || payload.stage || name;
      if (label) handlers.stage(label);
    }

    for (;;) {
      var step = await reader.read();
      if (step.done) break;
      buffer += decoder.decode(step.value, { stream: true });
      var boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        frame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
    }
    if (buffer.trim()) frame(buffer);
    return { payload: answerPayload, swap: swap };
  }

  /* Ask once. Resolves with the terminal answer payload and the settle verdict, or with
     a null payload after reporting the failure through `handlers`.

     It never rejects: a transport failure and a refused request are both ordinary
     outcomes of one question, and the caller draws a failed turn the same way either
     way. */
  async function run(request, handlers) {
    var response;
    try {
      response = await fetch(request.askUrl, {
        method: 'POST',
        // `Accept` is what selects the streaming shape of the response. The server
        // relays the chain's progress stages only to a caller that asks for an event
        // stream; without this header it answers with a single JSON object instead,
        // which is a silent downgrade rather than an error — the parser below then
        // finds no frames in it and the answer is discarded unread.
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'X-CSRFToken': request.csrfToken,
        },
        body: JSON.stringify(requestBody(request)),
      });
    } catch (error) {
      handlers.error(UNAVAILABLE);
      return { payload: null, swap: null };
    }

    if (!response.ok) {
      var failure = await response.json().catch(function () { return {}; });
      handlers.error(failure.error || UNAVAILABLE);
      if (response.status === 409) {
        // The thread this tab thought it was in has gone — swept, or deleted in
        // another tab. Re-reading the list is what puts the sidebar and the id back
        // in step with the store.
        handlers.threadGone();
      }
      return { payload: null, swap: null };
    }

    try {
      return await consume(response.body, handlers);
    } catch (error) {
      handlers.error(UNAVAILABLE);
      return { payload: null, swap: null };
    }
  }

  window.CopilotAsk = Object.freeze({ run: run, UNAVAILABLE: UNAVAILABLE });
})();
