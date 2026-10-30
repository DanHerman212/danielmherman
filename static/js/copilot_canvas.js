/* Enterprise Clinical Copilot — the conversation: the feed, the turn, and the ask bar.

   This file is the coordinator and nothing else. A turn is assembled here out of five
   single-purpose modules — `copilot_turn_facts.js` (what the turn says about itself),
   `copilot_progress.js` (the run while it runs), `copilot_answer.js` (the prose and the
   surface), `copilot_clipboard.js` (taking the answer away) and `copilot_ask.js` (the
   wire) — and this file owns only what none of them can: the order a turn is built in,
   the seam between the feed and the sidebar, and the submit.

   The canvas is one continuous column. There are no cards to fold away, no navigator
   above the composer, and no status row on a finished turn: each turn's question heads it
   and sticks to the top of the scroll area while its own answer passes under, and the
   hairline that closes the turn is what separates it from the next one.

   Plain JavaScript, for the same reason the composer is: the component framework in
   this project belongs to the A2UI renderer. The renderer is fetched on demand, once
   for the feed, and mounted per turn, because its module graph is large and nothing
   on first paint needs it. `import()` works from a classic script, so this needs no
   build step.

   The answer's prose arrives as it is written, when the request asks for it. That is a
   Phase 4 reversal of what this file used to assume, and it is asked for rather than
   assumed: the request body carries `stream_prose`, so a client that cannot draw the
   frames is never sent them.

   The consequence the old note named has not gone away — the guardrails rewrite the
   model's text after it finishes, so what arrives first is a draft. The server says so
   when the draft did not survive, on a `prose_settled` frame, and `copilot_ask.js` reads
   that frame while `fillTurn` acts on it: a `visible` swap says so in the turn's
   Evidence-Check notice, because a dose or a probability that appears on screen and is
   then withdrawn is something the reader is owed rather than something to tidy up
   quietly. A `silent` swap reconciles without comment — nothing was taken away. */
(function () {
  'use strict';

  var shell = document.getElementById('copilot-shell');
  var form = document.getElementById('cp-ask');
  var feed = document.getElementById('cp-feed');
  var patientField = document.getElementById('cp-patient-id');
  var intentField = document.getElementById('cp-command-intent');
  var input = document.getElementById('cp-ask-input');
  var remaining = document.getElementById('remaining');
  var patientPill = document.getElementById('cp-patient-pill');
  var patientLabel = document.getElementById('cp-patient-label');
  var patientClear = document.getElementById('cp-patient-clear');
  var contextPatient = document.getElementById('cp-context-patient');
  var contextName = document.getElementById('cp-context-name');
  var contextHadm = document.getElementById('cp-context-hadm');
  var contextState = document.getElementById('cp-context-state');
  var newButton = document.getElementById('cp-new-btn');
  var searchButton = document.getElementById('cp-search-btn');
  var searchRow = document.getElementById('cp-thread-search');
  var filterInput = document.getElementById('cp-thread-filter');
  var threadList = document.getElementById('cp-thread-list');
  var threadsEmpty = document.getElementById('cp-threads-empty');
  if (!shell || !form || !feed) return;

  var askUrl = shell.getAttribute('data-ask-url');
  var rendererUrl = feed.getAttribute('data-renderer-url');
  var conversationBase = feed.getAttribute('data-conversation-url');
  var historyUrl = feed.getAttribute('data-history-url');
  var feedbackUrl = feed.getAttribute('data-feedback-url');
  var retentionDays = feed.getAttribute('data-retention-days');
  if (!askUrl) return;

  var inFlight = false;

  /* An intent an affordance declared, held for exactly one submit.

     A clicked driver bar knows what kind of question it is asking and its wording
     cannot say so, so it sends the declaration beside the question. It is consumed by
     the submit it causes — the next thing asked is the reader's own and carries
     nothing — and it is cleared before that submit awaits anything, so a second
     submission cannot inherit it. */
  var declaredIntent = '';

  /* The thread on screen and the patient it belongs to live in
     `copilot_threads.js`, along with the sidebar that renders them: they are facts
     about the thread rather than about the feed, and the feed asks for them at the
     moment it needs one. */

  /* The route for one thread. The template has no id to substitute at render time,
     so the server's own path is the template and the trailing `0` is the
     placeholder — a conversation id is never 0, so nothing else can be. */
  function conversationUrl(pk) {
    if (!conversationBase) return '';
    return conversationBase.replace(/0\/$/, pk + '/');
  }

  function csrfToken() {
    var field = form.querySelector('[name=csrfmiddlewaretoken]');
    return field ? field.value : '';
  }

  function el(tag, className) {
    var node = document.createElement(tag);
    node.className = className;
    return node;
  }

  /* Bring a node's TOP into view, and never its bottom.

     A clinical answer is long — prose, a canvas, a references drawer, three questions — and
     it is read from the beginning. Scrolling to the bottom of the turn as it grew put the
     end of an answer on screen before the start of it, and every chunk that arrived moved
     the reader's own place. The anchor is the turn's head, set once when the turn is
     created; everything that arrives afterwards grows downward below the fold, where the
     reader will get to it at their own pace. */
  function scrollIntoView(node) {
    if (!node || !node.scrollIntoView) return;
    var reduce = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }

  /* Centre a node in the viewport, for a request that named it.

     Used when the reader has ASKED to be taken somewhere — a citation's "see all
     references" — which is the one case where moving their view is the point rather than
     an interruption. */
  function centreIntoView(node) {
    if (!node || !node.scrollIntoView) return;
    var reduce = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }

  /* What was asked, in the terms it was asked in: the command chosen in the
     composer, and anything typed alongside it.

     The patient is deliberately absent. The conversation is pinned to one admission
     and the pill above the feed says which, so a heading that repeated it would be
     the same words on every line of a thread about one patient.

     The command comes from the data attribute the composer sets when a command is
     chosen, and otherwise from the intent the composer is holding. The second route
     is what a submission with an empty composer uses: a patient and nothing typed
     still asks for the risk assessment, and a turn whose heading is the empty string
     is a turn with nothing to stick to the top of the scroll area.

     This string is both drawn and sent. The server stores it as the turn's heading,
     so a thread read back after a reload is headed with what the reader saw rather
     than with the prompt the command composes into. */
  function askedFor() {
    var parts = [];
    var command = form.getAttribute('data-command');
    if (command && command.trim()) {
      parts.push(command.trim());
    } else if (intentField && intentField.value.trim()) {
      var named = commandForIntent(intentField.value.trim());
      if (named) parts.push(named);
    }
    if (input && input.value.trim()) parts.push(input.value.trim());
    return parts.join(' ');
  }

  /* The command vocabulary the server owns, for naming the command a turn used.

     The whole list, not the menu's subset. This labels a turn that has already run, and a
     command hidden from the menu (`/risk`) is still one a reader can type and the agent
     still accepts — so dropping it here would only lose the heading above such a turn.
     Filtering for the menu happens where the menu is drawn. */
  function offeredCommands() {
    var node = document.getElementById('cp-command-data');
    if (!node) return [];
    try {
      var parsed = JSON.parse(node.textContent);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  /* The command a wire intent came from, so a submission that named no command can
     still be headed with the one it used. The vocabulary is the page's own list, so
     this cannot name a command the agent would not accept. */
  function commandForIntent(chip) {
    var found = '';
    offeredCommands().forEach(function (entry) {
      if (!found && entry.chip === chip) found = '/' + entry.command;
    });
    return found;
  }

  // --- the turn's own chrome ----------------------------------------------------

  /* A rating is a telemetry event, not a stored record. It is sent with the turn it
     belongs to so a later evals pass can join it to a trace, and nothing waits on the
     answer: a reader who rates and closes the tab is the normal case, and `keepalive` is
     what lets the request outlive the page. */
  function postFeedback(turnId, score) {
    if (!feedbackUrl) return;
    // A turn the server never stored has nothing to attach a rating to. It used to send
    // `unsaved:1` and be dropped at the other end; the console does not send it at all.
    if (!turnId) return;
    fetch(feedbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken(),
      },
      body: JSON.stringify({
        turn_id: turnId, score: score, timestamp: Date.now(),
      }),
      keepalive: true,
    }).catch(function () {
      // A rating that could not be sent is not worth an error in the reader's face.
    });
  }

  function markChosen(chosen) {
    [].forEach.call(chosen.parentNode.children, function (sibling) {
      sibling.classList.remove('is-chosen');
    });
    chosen.classList.add('is-chosen');
  }

  /* One control in the turn's action strip: an outline glyph and a tooltip.

     Outline rather than filled, and the same muted grey as the rest of the turn's
     chrome, so the row reads as an affordance beside the answer rather than as a
     reaction to it. The label lives on `title` and `aria-label` both — the glyph is
     the whole visible control, so the accessible name cannot be the glyph. */
  function iconButton(glyph, label, style) {
    var button = el('button', 'cp-turn-action');
    button.type = 'button';
    var icon = document.createElement('i');
    // The family is the caller's, defaulting to the outline set the rest of the turn's
    // chrome uses. It cannot be hardcoded: FontAwesome Free ships a limited REGULAR
    // subset, and an icon outside it draws nothing — which is not an empty control but
    // the browser's missing-glyph box, a rectangle with a cross in it. `fa-download` is
    // in that group, which is how this parameter came to exist (found in a screenshot,
    // 2026-10-16). Solid is the complete set, and `flash` already swaps to a solid check
    // in this same slot, so the element was never regular-only.
    icon.className = (style || 'fa-regular') + ' ' + glyph;
    icon.setAttribute('aria-hidden', 'true');
    button.appendChild(icon);
    button.title = label;
    button.setAttribute('aria-label', label);
    return button;
  }

  function ratingButton(glyph, label, score, turnIdOf) {
    var button = iconButton(glyph, label);
    button.addEventListener('click', function () {
      postFeedback(turnIdOf(), score);
      markChosen(button);
    });
    return button;
  }

  /* Confirmation on the control itself, so the strip does not gain a second element:
     the glyph becomes a check for a moment and returns, which also leaves the button
     ready to be used again. */
  function flash(button, className) {
    if (button.dataset.busy) return;
    button.dataset.busy = '1';
    var icon = button.querySelector('i');
    var was = icon ? icon.className : '';
    if (icon) icon.className = className;
    window.setTimeout(function () {
      if (icon) icon.className = was;
      delete button.dataset.busy;
    }, 1400);
  }

  /* Ask the question a rendered affordance asks, through the composer's own submit.

     Every row goes at once, not just the one clicked: two clicks on different rows
     would otherwise send both questions, and the second would be answered as a
     follow-up to something the reader never read the answer to. */
  function askFollowUp(question, buttons, intent) {
    buttons.forEach(function (button) { button.disabled = true; });
    if (!input || !form) return;
    input.value = question;
    if (intent) declaredIntent = intent;
    form.requestSubmit();
  }

  // --- one turn -----------------------------------------------------------------

  /* One turn: the question, whatever that turn drew, and the run while it runs.

     Everything the turn needs later is held here rather than looked up again, so two
     turns cannot reach into each other, and nothing in here is addressed by a page-wide
     id — a conversation holds several canvases and several status rows at once.

     The modules below are handed the elements they own and the few operations they
     cannot perform themselves, and they hand back an interface. That is the whole
     contract between this file and the five of them. */
  function createTurn(asked) {
    var root = el('article', 'cp-turn');

    /* What the answer rested on, as a quiet pill beside the question. Read from the tool
       calls the agent actually made, so it is a fact about the run rather than a claim
       the model made about itself. Absent for a redirect, which rested on nothing. */
    var scopeEl = el('span', 'cp-scope');
    scopeEl.hidden = true;
    /* Which command answered a question the reader did not type as one.
       Free text is routed deterministically before the model is consulted, so the
       command that answered is not a choice the reader made — and an answer that
       arrives in a shape they did not ask for has to say why. It borrows the scope
       pill's class because it is the same kind of statement: a fact about the turn
       rather than about the answer. */
    var routedEl = el('span', 'cp-scope cp-routed');
    routedEl.hidden = true;

    /* The verification notice. It sits in the heading beside the question rather than
       over the answer: it is a note about the turn, not a banner across what the
       clinician is reading, and the heading is the one part of a turn that outlives
       the run. Its full account lives on the title so the pill can stay small. */
    var evidence = el('span', 'cp-evidence');
    evidence.setAttribute('role', 'status');
    evidence.setAttribute(
      'title',
      'Part of what was shown while this answer was being written was removed after it '
        + 'was checked against the record. The answer below is the verified version.');
    evidence.hidden = true;

    // A heading, not a toggle. A clinician must never have to click to read an
    // earlier turn, so there is nothing here to click: the question is text, and the
    // stylesheet pins it to the top of the scroll area while its answer passes
    // beneath it.
    var head = el('header', 'cp-turn-head');
    var title = document.createElement('h2');
    title.className = 'cp-turn-title';
    title.textContent = asked || '';

    var body = el('div', 'cp-turn-body');
    var answerSection = el('section', 'cp-answer');
    var canvasHost = el('div', 'cp-canvas');
    var prose = el('div', 'cp-answer-text');
    answerSection.append(canvasHost, prose);

    /* The last presentation this turn was given.

       Held because the answer text is not always in this turn's DOM: when the agent
       composes a surface that renders the prose, the console is told not to draw the
       answer again (`renders_prose`), so `.cp-answer-text` is empty by design and both
       the text to copy and the rows to export live in the payload. */
    var latest = null;

    /* The records the markers resolve to, the next questions, and what the reader
       thought of the answer. All three are chrome under the answer rather than part of
       it, and all three are absent on most turns. */
    var trail = el('div', 'cp-turn-trail');
    var references = el('details', 'cp-references');
    references.hidden = true;
    var followUps = el('div', 'cp-follow-ups');
    followUps.hidden = true;

    /* What the reader thought of this answer, and a copy of it.

       Held in the trail rather than in the status footer, because the footer does not
       survive the run: retiring it would take the rating with it, and a rating control
       that vanishes as the answer lands is one nobody can use. */
    var actions = el('div', 'cp-turn-actions');
    actions.hidden = true;

/* The stored answer's own id, set as soon as the payload carrying it arrives.

     This is the identity a rating is sent under, and it comes from the server rather
     than from the page. Until 2026-10-30 the console composed `<conversation>:<n>` from
     `++turnOrdinal`, a counter that restarts at 1 on every load, so a rating on a
     restored thread named whichever answer came first in the conversation — and on a
     thread longer than this page had drawn, named nothing at all. Only the row that
     stored the answer knows which row stored the answer. */
    var storedTurnId = '';
    function thisTurnId() {
      return storedTurnId;
    }

    var answers = window.CopilotAnswer.create({
      el: el,
      root: root,
      prose: prose,
      answerSection: answerSection,
      rendererUrl: rendererUrl,
      onReconciled: function () { facts.reconciled(); },
    });

    var facts = window.CopilotTurnFacts.create({
      el: el,
      scopeEl: scopeEl,
      routedEl: routedEl,
      evidenceEl: evidence,
      references: references,
      followUps: followUps,
      askFollowUp: askFollowUp,
      revealMarker: answers.revealMarker,
      centreIntoView: centreIntoView,
    });

    var clipboard = window.CopilotClipboard.create({
      el: el,
      iconButton: iconButton,
      flash: flash,
      latestOf: function () { return latest; },
      textOf: function () { return (latest && latest.answer) || prose.textContent || ''; },
      turnIdOf: thisTurnId,
    });

    /* The card's "See all references": the drawer is this turn's, so the request is
       answered here even though the row it lands on is drawn by the facts module — the
       card announces the intent with a composed event because it lives inside shadow
       trees this page does not own. */
    root.addEventListener('citation-see-all', function (event) {
      facts.showReference((event.detail || {}).index);
    });

    var progress = window.CopilotProgress.create({
      el: el,
      root: root,
      body: body,
      prose: prose,
      answer: answers,
      onSettled: function () {
        actions.hidden = false;
        clipboard.setExportable();
        clipboard.toolbar.hidden = false;
      },
    });

    actions.append(
      ratingButton('fa-thumbs-up', 'Helpful answer', 1, thisTurnId),
      ratingButton('fa-thumbs-down', 'Unhelpful answer', -1, thisTurnId)
    );

    head.append(title, scopeEl, routedEl, evidence, clipboard.toolbar);
    trail.append(references, followUps, actions);

    body.append(answerSection, trail);

    /* Opening a turn retires the previous turn's follow-up rows.

       The rows are a prompt to ask the next question, so they belong to the turn being
       read and to no other. Doing it here rather than in `fillTurn` makes the rule
       structural: turns are created oldest-first whether they arrive live or are
       replayed from the store, so the newest one's rows are laid down last and survive,
       and no path has to know which turn is current. */
    [].forEach.call(feed.querySelectorAll('.cp-follow-ups'), function (older) {
      older.hidden = true;
      older.textContent = '';
    });

    root.append(head, body, progress.foot);
    feed.appendChild(root);

    function presentFacts(payload) {
      latest = payload;
      // Both paths arrive here — a live answer through the `answer` frame and a restored
      // turn through `turn_payloads` — so this is the one place the turn learns which
      // stored row it is. Read before anything draws, because the rating controls are
      // built from it.
      if (payload && payload.turn_id !== null && payload.turn_id !== undefined) {
        storedTurnId = String(payload.turn_id);
      }
      facts.present(payload);
    }

    return {
      root: root,
      canvas: canvasHost,
      prose: prose,
      stage: progress.stage,
      finish: progress.finish,
      restore: progress.restore,
      say: progress.say,
      appendProse: answers.appendProse,
      hasProse: answers.hasProse,
      abandonDraft: answers.abandonDraft,
      flushProse: answers.flushProse,
      settle: answers.settle,
      settleProse: answers.settleProse,
      presentFacts: presentFacts,
      answer: function (message) { progress.say(message || ''); },
    };
  }

  function turns() {
    return [].slice.call(feed.querySelectorAll('.cp-turn'));
  }

  /* Mounting the surface belongs to `copilot_answer.js`, which owns the renderer and the
     draft it is cross-faded against; this is the name `fillTurn` reads. */
  function mountSurface(host, envelope) {
    return window.CopilotAnswer.mount(host, envelope, rendererUrl);
  }

  /* Fill a turn from the canonical payload — the same shape a stored turn is
     restored with, which is what keeps one renderer for both.

     The order of the three steps is the second defect. The draft finishes pouring
     before anything replaces it; the surface is mounted invisible over it; and only
     then does the handover happen. What used to happen was a wipe on the first
     statement and a dump on the third.

     The surface draws the prose itself when it carries the cited narrative, and the
     envelope says so with `renders_prose`; writing the answer here as well would
     print it twice, once with nothing clickable. The prose element stays because it is
     where an error, a refusal, or a turn with no canvas is written — and because it is
     where the draft lived. */
  async function fillTurn(block, payload) {
    var envelope = payload.a2ui || null;
    var drawsProse = !!(envelope && envelope.renders_prose);
    // Before the answer is drawn, so the turn's chrome and its text arrive together
    // rather than the chrome appearing under text that is already being read.
    block.presentFacts(payload);

    await block.flushProse();

    if (!drawsProse || !envelope.messages) {
      // Nothing draws this prose but this element, so the answer is written here. For a
      // turn that streamed it is the same text the reader has just finished reading.
      block.answer(payload.answer || '');
      return;
    }

    var surface = null;
    try {
      surface = await mountSurface(block.canvas, envelope);
    } catch (error) {
      // A composed surface is a bonus on top of the prose: if the renderer cannot
      // mount, the answer the clinician needs is already on screen and stays there.
      console.error('a2ui: the composed surface could not be drawn', error);
      return;
    }
    await block.settle(surface);
  }

  // --- the context bar ----------------------------------------------------------

  /* What the whole thread is: which patient, and how long the store will keep it.
     Both are properties of the conversation rather than of the turn being read,
     which is why they sit above the feed.

     The turn counter is deliberately absent. "Turn 3 of 20" is the system's
     bookkeeping rather than the clinician's, and a limit a reader can run into
     without having done anything wrong is not something to keep in front of them. */
  function updateContext(expiresAt) {
    if (!contextState) return;
    if (expiresAt) {
      var when = new Date(expiresAt);
      contextState.textContent = isNaN(when.getTime())
        ? ''
        : 'Saved until ' + when.toLocaleDateString(
            undefined, { day: 'numeric', month: 'short' });
    } else if (retentionDays) {
      // Before a thread exists there is no expiry to state, so the window itself is
      // the fact worth showing.
      contextState.textContent = 'Threads are kept ' + retentionDays + ' days';
    } else {
      contextState.textContent = '';
    }
  }

  function clearContext() {
    if (contextPatient) contextPatient.hidden = true;
    if (contextName) contextName.textContent = '';
    if (contextHadm) contextHadm.textContent = '';
    updateContext(null);
  }

  /* The chosen patient's name, as a name rather than as the token that picked them.
     The composer writes `@Cynthia Petrov` into the pill because that is how the
     patient was chosen; the context bar is prose about who the thread is about. */
  function patientName() {
    if (!patientLabel) return '';
    return patientLabel.textContent.trim().replace(/^@/, '');
  }

  function setPatient(name, hadmId) {
    if (!name) return;
    if (patientLabel) patientLabel.textContent = name;
    if (patientPill) patientPill.hidden = false;
    if (patientField) patientField.value = String(hadmId);
    if (contextPatient) contextPatient.hidden = false;
    if (contextName) contextName.textContent = name;
    if (contextHadm) contextHadm.textContent = '#' + hadmId;
  }

  // --- asking -------------------------------------------------------------------

  /* The frames of one run are `copilot_ask.js`': it assembles the body, sends it, and
     parses what comes back. This function is what a frame does to the page. */
  async function send(hadmId) {
    // Taken before the first await: an affordance's declaration belongs to the submit
    // it caused, and a submission that suspends before reading it is one another
    // submission could take it from.
    var declared = declaredIntent;
    declaredIntent = '';

    // Before anything is sent: the thread on screen must be this patient's, and the
    // id sent must be that thread's.
    await window.CopilotThreads.syncToPatient(hadmId);

    var chip = intentField ? intentField.value : '';
    var typed = input ? input.value.trim() : '';

    // The heading is read now and sent with the request, so the turn the store keeps
    // is headed with the words the reader saw. The server cannot reconstruct this: it
    // is handed an intent, not the vocabulary the console drew it from.
    var heading = askedFor();

    // The feed does not return to its empty state between questions: the turns of one
    // patient's thread are one column, oldest first, and the newest is appended.
    var block = createTurn(heading);
    // The context bar mirrors the pill the composer already set: the patient belongs
    // to the conversation, so it is shown once above the thread rather than repeated
    // on every heading.
    setPatient(patientName(), hadmId);
    scrollIntoView(block.root);
    // The patient pill stays: the admission is what the next question is about. The
    // command and the typed text do not — both belong to the question just asked. A
    // command left pinned would make the next typed question arrive as a command AND a
    // question, which the server refuses as two intentions rather than resolving
    // quietly (ECC-22); and text left in the box would be sent again by the next
    // submit.
    form.dispatchEvent(new CustomEvent('cp:command-consumed'));
    if (input) {
      input.value = '';
      input.setSelectionRange(0, 0);
      input.focus();
      // Clearing a field in code fires no `input` event, and the composer sizes itself
      // from that event — so without this the box would keep the height of the question
      // it just sent instead of collapsing back to one line.
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    var failed = false;

    var settled = await window.CopilotAsk.run({
      askUrl: askUrl,
      csrfToken: csrfToken(),
      hadmId: hadmId,
      conversationId: window.CopilotThreads.conversationId(),
      declared: declared,
      chip: chip,
      question: typed,
      asked: heading,
    }, {
      stage: function (label) {
        // A stage that arrives after this turn has already drawn prose is the run going
        // back for evidence: the model spoke, was sent to a tool or told to retrieve, and
        // will answer again. What is on screen belongs to the first pass and is not the
        // answer, so it is dropped here, at the frame that says so — the reader watches the
        // run move on rather than watching a sentence arrive and be taken away.
        if (block.hasProse()) block.abandonDraft();
        block.stage(label);
      },
      prose: function (text) { block.appendProse(text); },
      remaining: function (value) {
        if (remaining && value !== undefined) remaining.textContent = value;
      },
      error: function (message, value) {
        failed = true;
        if (remaining && value !== undefined) remaining.textContent = value;
        block.finish();
        block.say(message, true);
      },
      threadGone: function () {
        window.CopilotThreads.forget();
        window.CopilotThreads.load();
      },
    });

    var answerPayload = settled.payload;

    if (answerPayload) {
      if (remaining && answerPayload.remaining !== undefined) {
        remaining.textContent = answerPayload.remaining;
      }
      // The server is the authority on which thread this turn landed in: it answers
      // with the id it used or opened, and adopting it is what makes the next
      // question a follow-up instead of a new thread.
      if (answerPayload.conversation_id) {
        window.CopilotThreads.remember(
          answerPayload.conversation_id, hadmId);
      }
      block.finish();
      await fillTurn(block, answerPayload);
      // After the settled answer is drawn, not before. The notice describes a
      // correction to the text that is now on screen, and a notice shown before the
      // text it is about would point at a draft that is about to be replaced.
      block.settleProse(settled.swap);
      updateContext(answerPayload.expires_at);
      // The list is re-read because asking about a new patient is what creates their
      // thread, so the sidebar is one patient out of date otherwise.
      window.CopilotThreads.load();
      return;
    }

    if (failed) return;

    // Prose arrived and no settled answer followed: the stream closed early. There is
    // no answer payload, yet the block does have prose, so nothing above finishes the
    // turn and the composer would stay pending with a half-written answer on screen and
    // no explanation (reported 2026-10-16 from an unrecognised slash command).
    // Finishing is the whole fix: the prose the reader already has is kept rather than
    // replaced by a generic failure, because the failure was in the transport, not the
    // answer.
    block.finish();
  }

  // --- wiring -------------------------------------------------------------------
  //
  // The sidebar's own wiring — the new-thread button, the search toggle, the filter,
  // and the row menu's dismissal listeners — lives in `copilot_threads.js`, beside
  // the DOM it drives. What is left here is the feed and the submit.

  /* An affordance inside a composed surface asking its own question: a clicked risk
     driver, and nothing else today. Listened for on the feed rather than on each turn,
     because the surfaces are created per turn and per answer and a listener attached
     with each of them would be one per turn, kept for as long as the thread is.

     It goes through the composer's submit rather than a request of its own — the
     comment on `askFollowUp` says why — so the declaration travels with the question
     in `declaredIntent` and leaves with the same submit. */
  feed.addEventListener('a2ui-follow-up', function (event) {
    var detail = event.detail || {};
    if (!detail.question) return;
    askFollowUp(detail.question, [], detail.intent);
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (inFlight) return;

    // An empty composer is not a question. Until 2026-10-26 this case silently became
    // the readmission-risk command, so pressing Enter with a patient selected billed a
    // turn about nothing the reader asked. That command is gone and no default replaces
    // it: with nothing declared and nothing typed there is nothing to send, so nothing
    // is sent and no turn is drawn — the same silence as pressing Enter in a box the
    // reader had not started typing in.
    var says = input ? input.value.trim() : '';
    var armed = intentField ? intentField.value.trim() : '';
    if (!declaredIntent && !says && !armed) return;

    var hadmId = patientField ? patientField.value : '';
    if (!hadmId) {
      // A refusal is a turn too, and it belongs in the feed where the reader is
      // looking.
      var refusal = createTurn('No patient selected');
      refusal.say('Choose a patient first — type @ and a name.', true);
      refusal.finish();
      scrollIntoView(refusal.root);
      return;
    }

    inFlight = true;
    send(hadmId).finally(function () { inFlight = false; });
  });

  /* What `copilot_threads.js` is allowed to drive.

     The feed and the thread list used to be one closure, so every call between them
     was a free variable. This is that seam written down: the thread module restores a
     stored thread into the feed, empties it, mirrors the patient and the context bar,
     and asks which turns are on screen. Nothing here lets it reach the turn internals
     — a thread row is not allowed to draw a turn, and the only way to put one on the
     screen is `createTurn` and `fillTurn`, which are the same pair a live answer uses.

     Frozen, and read by the other module at call time rather than captured at load:
     this file is the last script on the page, so the thread module exists first and
     must not have cached a handle to a feed that had not been built yet. */
  window.CopilotFeed = Object.freeze({
    createTurn: createTurn,
    fillTurn: fillTurn,
    turns: turns,
    scrollTo: scrollIntoView,
    clear: function () { feed.textContent = ''; },
    patient: setPatient,
    context: updateContext,
    clearContext: clearContext,
    focusInput: function () { if (input) input.focus(); },
    dropPin: function () { if (patientClear) patientClear.click(); },
    csrfToken: csrfToken,
    conversationUrl: conversationUrl,
  });

  /* Where the tab left off, and the list it left off in. The thread module owns both:
     it reads the sidebar and restores the thread this tab was in. */
  updateContext(null);
  window.CopilotThreads.start();
})();
