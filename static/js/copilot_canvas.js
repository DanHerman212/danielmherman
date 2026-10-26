/* Enterprise Clinical Copilot — the conversation and the thread list.

   Two surfaces, one file, because they are two views of the same thing. A turn the
   reader asks for and a turn the store hands back are drawn by the same pair
   (`createTurn` and `fillTurn`), and the sidebar's rows are the threads those turns
   belong to. Splitting them would give one fact two implementations.

   The canvas is one continuous column. There are no cards to fold away, no
   navigator above the composer, and no status row on a finished turn: each turn's
   question heads it and sticks to the top of the scroll area while its own answer
   passes under, and the hairline that closes the turn is what separates it from the
   next one.

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
   when the draft did not survive, on a `prose_settled` frame, and that frame is what
   this file acts on: a `visible` swap replaces the text and says so in the turn's
   Evidence-Check notice, because a dose or a probability that appears on screen and is
   then withdrawn is something the reader is owed rather than something to tidy up
   quietly. A `silent` swap reconciles without comment — nothing was taken away.

   Characters arrive faster than they can be read, so they are released to the screen
   at a reading cadence. That pacing lives here and nowhere earlier: a byte held at the
   agent or at the Django proxy would buy smoothness with time to first token, which is
   the one number worth protecting. Held at the last stop before the DOM, the answer
   arrives as fast as the network allows and is drawn at a speed a person can follow. */
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

  var renderer = null;          // resolved on the first answer, then reused
  var rendererPromise = null;   // one import, however many turns ask for it
  var inFlight = false;

  /* An intent an affordance declared, held for exactly one submit.

     A clicked driver bar knows what kind of question it is asking and its wording
     cannot say so, so it sends the declaration beside the question. It is consumed by
     the submit it causes — the next thing asked is the reader's own and carries
     nothing — and it is cleared before that submit awaits anything, so a second
     submission cannot inherit it. */
  var declaredIntent = '';

  /* Turns carry no server id in the browser, so one is minted here: the conversation it
     belongs to and its ordinal within that conversation. Stable for as long as the
     thread is on screen, which is as long as a rating can be given. */
  var turnOrdinal = 0;

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

  // --- streaming cadence (Phase 4 §1.4, revised Phase 5B) ------------------------

  /* The cadence lives in `copilot_reveal.js`, and the reason is that the old one was
     wrong in a way nothing could see.

     It released 45 characters a second against a model that writes two or three
     hundred, so the queue could only grow: an answer longer than 45 x (stream
     duration) was guaranteed to still be behind when the settled answer landed, and
     the swap then discarded whatever was left. That piece now tracks the inflow with
     a bounded lag instead of a fixed speed, and finishes pouring on a deadline before
     anything replaces it.

     This file keeps the half that draws. `PACING` and the state machine moved because
     a cadence that can only be exercised in a browser is a cadence that only ever gets
     redesigned by argument. */

  /* How long the settled surface and the draft cross-fade over. Short enough to read as
     one state becoming another rather than as an animation, and matched to
     `.cp-answer.is-settling` in the stylesheet. */
  var SETTLE_MS = 180;

  /* Reduced motion skips the pacing rather than shortening it — the request is for no
     animated text, not for faster animated text. Read on each use rather than once,
     because the setting can change while the page is open. */
  var reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  /* One painted frame later. Two of these is the shortest reliable "the browser has
     laid this out" available to a page that does not control its own stylesheet. */
  function nextFrame() {
    return new Promise(function (resolve) {
      if (window.requestAnimationFrame) {
        window.requestAnimationFrame(function () { resolve(); });
        return;
      }
      window.setTimeout(resolve, 16);
    });
  }

  function wait(ms) {
    return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
  }

  // --- one turn -----------------------------------------------------------------

  /* One turn: the question, whatever that turn drew, and the run while it runs.

     Everything the turn needs later is closed over rather than looked up again, so
     two turns cannot reach into each other, and nothing in here is addressed by a
     page-wide id — a conversation holds several canvases and several status rows at
     once. */
  /* A rating is a telemetry event, not a stored record. It is sent with the turn it
     belongs to so a later evals pass can join it to a trace, and nothing waits on the
     answer: a reader who rates and closes the tab is the normal case, and `keepalive` is
     what lets the request outlive the page. */
  function postFeedback(turnId, score) {
    if (!feedbackUrl) return;
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

  function copyButton(source) {
    var button = iconButton('fa-copy', 'Copy this answer');
    button.addEventListener('click', function () {
      var text = source ? source.textContent : '';
      if (!text) return;
      // Clipboard access can be refused — an insecure origin, a denied permission — and
      // a copy that silently did nothing is worse than one that admits it.
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          flash(button, 'fa-solid fa-check');
        }, function () {
          flash(button, 'fa-solid fa-triangle-exclamation');
        });
      } else {
        flash(button, 'fa-solid fa-triangle-exclamation');
      }
    });
    return button;
  }

  /* Put text on the clipboard, and say on the control whether it worked.

     Clipboard access can be refused — an insecure origin, a denied permission — and a
     copy that silently did nothing is worse than one that admits it. An empty string
     gets its own refusal: it means the turn carried nothing to copy, which is a
     different failure from the browser saying no, and it must not look like success. */
  function copyText(text, button) {
    if (!text) {
      flash(button, 'fa-solid fa-ban');
      return;
    }
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      flash(button, 'fa-solid fa-triangle-exclamation');
      return;
    }
    navigator.clipboard.writeText(text).then(function () {
      flash(button, 'fa-solid fa-check');
    }, function () {
      flash(button, 'fa-solid fa-triangle-exclamation');
    });
  }

  /* The display precision for a probability, matching the widget's own formatter.

     A second copy of one line, and it is deliberate: this file is served as a plain
     script while the component bundle that draws the widget is a separate entry, so the
     two cannot import from each other. The alternative was to export a raw 0.090459 under
     a column headed by a rate, which is the disagreement worth avoiding — an export that
     does not say what the screen says is worse than two one-line formatters. */
  function askFollowUp(question, buttons, intent) {
    // Every row goes at once, not just the one clicked: two clicks on different rows
    // would otherwise send both questions, and the second would be answered as a
    // follow-up to something the reader never read the answer to.
    buttons.forEach(function (button) { button.disabled = true; });
    if (!input || !form) return;
    input.value = question;
    if (intent) declaredIntent = intent;
    form.requestSubmit();
  }

  function createTurn(asked) {
    var root = el('article', 'cp-turn');

    /* The verification notice, present in every turn and shown only by the one case that
       earns it. It sits in the heading beside the question rather than over the answer:
       it is a note about the turn, not a banner across what the clinician is reading.

       The full account lives on the title so the pill can stay small without
       withholding it — the label says a check was applied, and the hover says what it
       did. Built here, before the heading, because the heading is where it goes; the
       footer would not do, because the footer is retired when the run ends, and the
       heading is the one part of a turn that outlives the run. */
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

    var evidence = el('span', 'cp-evidence');
    evidence.setAttribute('role', 'status');
    evidence.setAttribute(
      'title',
      'Part of what was shown while this answer was being written was removed after it '
        + 'was checked against the record. The answer below is the verified version.');
    evidence.hidden = true;

    /* The turn's utility toolbar, opposite the title in the header.

       One toolbar per TURN rather than one per surface, because a unified `/ehr` turn
       carries two surfaces in one answer and two toolbars would be two places to look for
       the same two actions. It sits in the header rather than under the answer because
       these are actions on the answer as a whole, and the header is the part of a turn
       that outlives the run — the same reason the Evidence-Check notice lives here and
       the status row does not.

       Revealed by `retire`, like the rating strip: copying or exporting an answer that is
       still being written would either be empty or export a half-composed surface. */
    var toolbar = el('div', 'cp-turn-toolbar');
    toolbar.hidden = true;
    var copyAll = iconButton('fa-copy', 'Copy the answer');
    copyAll.addEventListener('click', function () { copyText(answerText(), copyAll); });

    /* Export, offered only when the turn drew a table.

       The rows come from `CopilotTSV.structuredRows` — the same function and the same
       source the rest of this file reads — so what a reader downloads is what the tool returned rather than
       what the widget painted. The file is tab-separated and named `.tsv` rather than
       `.csv`: a clinical value may contain a comma and may not contain a tab, so the
       delimiter cannot collide with a field and no quoting rule has to be invented here and
       kept in step with another one somewhere else. */
    var exportAll = iconButton('fa-download', 'Export this table', 'fa-solid');
    exportAll.hidden = true;
    exportAll.addEventListener('click', function () {
      var rows = window.CopilotTSV.structuredRows(latest && latest.a2ui);
      if (!rows) { flash(exportAll, 'fa-solid fa-ban'); return; }
      var blob = new Blob([rows + '\n'],
                          { type: 'text/tab-separated-values;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      // Named for the turn, so two exports from one thread do not overwrite each other.
      link.download = 'ecc-turn-'
        + String(thisTurnId()).replace(/[^a-zA-Z0-9]+/g, '-') + '.tsv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      flash(exportAll, 'fa-solid fa-check');
    });

    toolbar.append(copyAll, exportAll);

    // A heading, not a toggle. A clinician must never have to click to read an
    // earlier turn, so there is nothing here to click: the question is text, and the
    // stylesheet pins it to the top of the scroll area while its answer passes
    // beneath it.
    var head = el('header', 'cp-turn-head');
    var title = document.createElement('h2');
    title.className = 'cp-turn-title';
    title.textContent = asked || '';
    head.append(title, scopeEl, routedEl, evidence, toolbar);

    var body = el('div', 'cp-turn-body');
    var answerSection = el('section', 'cp-answer');
    var canvas = el('div', 'cp-canvas');
    var prose = el('div', 'cp-answer-text');
    answerSection.append(canvas, prose);

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
       survive the run: `retire` removes it the moment the answer is settled, and a
       rating control that vanishes as the answer lands is one nobody can use. The rule
       is the same one the Evidence-Check notice follows, and for the same reason — the
       parts of a turn that outlive the run are the heading and the trail. */
    var actions = el('div', 'cp-turn-actions');
    actions.hidden = true;
    /* A turn's own id is composed when a rating is sent, not when the turn is built.

       The conversation's id arrives with the first answer rather than before it, so a
       turn that minted its id on creation logged `unsaved:1` — a rating that identifies
       nothing and cannot be joined to a trace, which is the only thing it is for. */
    var ordinal = ++turnOrdinal;
    function thisTurnId() {
      // Read at click time, from the module that owns it: a turn is rated after the
      // turn that minted its ordinal, and by then the thread may have moved on.
      return (window.CopilotThreads.conversationId() || 'unsaved') + ':' + ordinal;
    }
    actions.append(
      ratingButton('fa-thumbs-up', 'Helpful answer', 1, thisTurnId),
      ratingButton('fa-thumbs-down', 'Unhelpful answer', -1, thisTurnId)
    );

    /* The answer as text, for the toolbar's Copy.

       The surface's own copy first: for a turn that draws its prose, this element is
       empty and reading it would put nothing on the clipboard while the control said
       "Copied". The element is still the answer for the turns where this file draws it. */
    function answerText() {
      return (latest && latest.answer) || prose.textContent || '';
    }

    trail.append(references, followUps, actions);

    /* A clicked risk driver asks its own question, through the same door a clicked
       follow-up row uses. The event is composed, so it leaves the renderer's shadow
       root and arrives at the feed, which listens ONCE for the whole column: a listener
       here would be one per turn, kept for as long as the thread is, and the click also
       declares an intent that only the feed's listener carries. */

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

    /* The run, while it is running. The dots say it is still going and the label
       says where it is; each stage replaces the label as it arrives, so what the
       reader sees is the run's latest news rather than a log of it.

       The labels are also kept, because a replaced label is not a forgotten one: once
       the turn settles they become a collapsed disclosure under the answer. That is
       the one thing this row can offer after it stops being a status — the order in
       which the run actually did its work — and it is what a reader reaches for when
       an answer looks thin or stopped early. While the run is live the row is a plain
       live region with no control on it, so nothing is hidden behind a chevron at the
       moment the reader most wants to see the run move. */
    var stages = [];  // every label this run passed through, in order
    var status = el('div', 'cp-status');
    status.setAttribute('role', 'status');
    var dots = el('span', 'typing-dots');
    dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = '<span></span><span></span><span></span>';
    var statusText = el('span', 'cp-status-text');
    statusText.textContent = 'Sending the question';
    status.append(dots, statusText);

    var foot = el('footer', 'cp-turn-foot');
    foot.appendChild(status);

    root.append(head, body, foot);
    feed.appendChild(root);

    /* The row is only there while there is something to say. A finished turn says
       nothing about itself — "Answered" is the absence of news dressed as a status,
       and the hairline that closes the turn already separates it from the next one. */
    var retired = false;
    function retire() {
      // Idempotent, and it has to be: a failed run calls `finish` and then the error
      // path calls it again, and the second call found `status` already replaced by
      // the stage history — `replaceChild` then threw, which left a correct answer on
      // screen beside a red banner (seen 2026-10-17).
      if (retired) return;
      retired = true;
      if (foot.parentNode) {
        // The run's own history is kept — the labels are the account of what the run did
        // — but it belongs under the HEADER now rather than under the answer. It is the
        // first thing about this turn, not the last: a reader checking whether the
        // assistant looked at the right places wants that before the prose, and at the
        // foot of a long answer it was below the fold of a screen they had already read
        // past. The live row it replaces goes with the foot; what is left of the foot is
        // nothing.
        var history = stageHistory();
        if (history) root.insertBefore(history, body);
        foot.remove();
      }
      // The run is over and the turn is settled. Both paths land here — `finish` for a
      // live run, `restore` for a turn read back from the store — so this is the one
      // place that means "the answer is final", which is the moment a rating becomes a
      // statement about an answer rather than about a question, and the moment there is
      // something to copy or export at all.
      actions.hidden = false;
      // The export is offered only when there is a table to export, decided here rather
      // than at click time so the control does not appear and then refuse.
      exportAll.hidden = !window.CopilotTSV.structuredRows(latest && latest.a2ui);
      toolbar.hidden = false;
    }

    function stage(label) {
      if (label === statusText.textContent) return;
      // The opening label is a stage too: the run began there, and a history that starts
      // at the second label would be missing the only one the reader already watched.
      if (!stages.length) stages.push(statusText.textContent);
      // A label that repeats is the run coming back to a stage — the loop, not a new
      // step — so it is recorded again rather than deduplicated.
      stages.push(label);
      statusText.textContent = label;
      // Restart the fade, so a replaced stage reads as replaced even when the two
      // arrive a moment apart.
      statusText.style.animation = 'none';
      void statusText.offsetWidth;
      statusText.style.animation = '';
    }

    /* The stages this run passed through, as a collapsed disclosure, or null when there
       were none to keep. Closed on arrival: the answer is what the reader came for, and
       the run's route is the footnote under it, not a second thing to read. */
    function stageHistory() {
      if (!stages.length) return null;
      var details = el('details', 'cp-stages');
      var summary = el('summary', 'cp-stages-summary');
      // Named, not just counted. "8 steps" says how much there is to open and nothing
      // about what opens, which is the one thing a reader needs before deciding to.
      summary.textContent = 'Agent workflow - ' + stages.length
        + (stages.length === 1 ? ' step' : ' steps');
      var list = el('ol', 'cp-stages-list');
      stages.forEach(function (label) {
        var item = el('li', 'cp-stages-item');
        item.textContent = label;
        list.appendChild(item);
      });
      details.append(summary, list);
      return details;
    }

    function finish() {
      retire();
    }

    /* A turn that came back from the store.

       `steps` is the workflow the agent recorded with the answer (Phase B). Without it a
       refreshed turn showed nothing about how it was answered: those labels only ever
       existed as progress frames, and frames die with the response that carried them.

       The console's own opening row — "Sending the question" — is NOT one of the agent's
       steps. It is drawn locally the moment a question is submitted, before any frame has
       arrived, so it is put back here. That is what makes a refreshed turn show the same
       count and order as the live one rather than one row fewer, and it is why the label
       is read off the status element rather than written a second time. */
    function restore(steps) {
      var labels = (steps || []).filter(function (label) {
        return typeof label === 'string' && label.trim();
      });
      if (labels.length && labels[0] !== statusText.textContent) {
        labels.unshift(statusText.textContent);
      }
      stages.length = 0;
      labels.forEach(function (label) { stages.push(label); });
      retire();
    }

    function say(message, isError) {
      // A run that failed after it had already put words on screen did not fail to
      // answer: it answered part of the way and then stopped. Replacing that text
      // takes back work the reader has already done, so the failure is stated beneath
      // it instead. The prose stays; the reader is told the run did not finish.
      if (isError && hasProse()) {
        interrupt(message);
        return;
      }
      // The settled answer is the authority on this turn's text, so it is written over
      // the draft and the draft's remainder is dropped rather than drained. A character
      // released after this line would append to the settled answer and corrupt it.
      resetDraft();
      prose.textContent = message;
      if (isError) prose.classList.add('cp-answer-error');
      // No correction to the status row here: every path that reports a failure also
      // finishes the turn, and finishing retires the row. Writing "Not answered" into
      // a detached node would be a line that runs and does nothing.
    }

    /* A run that stopped midway, with the reader already reading it.

       Two things are true at once and the draft handling has to honour both: what is
       on screen arrived correctly and is kept, and what is still queued arrived before
       the failure and belongs to the same answer, so it is drawn rather than dropped.
       Only then is the queue stopped. The notice is a pill under the prose, not a
       banner over the turn — it qualifies the text above it and does not replace it. */
    var notice = null;
    function interrupt(message) {
      // What is still queued arrived before the failure and belongs to the same answer,
      // so it is drawn rather than dropped. Only then does the cadence stop — and the
      // draft is emphatically not reset, because the text already on screen is the
      // part of the answer the reader has done the work of reading.
      if (reveal.pending) reveal.drainNow();
      reveal.cancel();
      if (!notice) {
        notice = el('div', 'cp-answer-interrupted');
        notice.setAttribute('role', 'status');
        prose.parentNode.insertBefore(notice, prose.nextSibling);
      }
      notice.textContent = '\u26a0\ufe0f Copilot run incomplete. ' + message;
    }

    /* The answer as it is written, held to a reading cadence.

       `say` replaces, which is what a settled answer needs; a delta appends, which is
       what a stream of them needs. The cadence itself lives in `copilot_reveal.js`; this
       is the half that draws, and what it receives is a slice of the answer, in order,
       exactly once.

       Two things the draft keeps that the old one did not. A finished block is rendered
       as markdown the moment it finishes, so headings and paragraphs arrive in the
       typography the settled answer will use — the old draft was a text node, and a text
       node turns every blank line into a space, which is why it arrived as one paragraph.
       And the unfinished block keeps its citation markers, drawn as inert pills: a marker
       is the thing a clinical reader scans for, and the answer used to lose every one of
       them while it was being written and give them back when it stopped.

       None of this sanitises anything the reader typed. A block goes through the
       renderer's own provider, which is the same one the surface uses, and a block is only
       ever text that arrived from the agent. */
    var streamed = '';   // every character released, for the block renderer
    var committed = 0;   // how many blocks have been rendered, so each is rendered once
    var tail = null;     // the element holding the unfinished block

    var reveal = window.CopilotReveal.create(function (slice) {
      streamed += slice;
      renderDraft();
    }, { reducedMotion: reduceMotion.matches });

    function renderDraft() {
      var parts = window.CopilotDraft.partition(streamed);
      for (var index = committed; index < parts.blocks.length; index += 1) {
        renderBlock(parts.blocks[index]);
      }
      committed = parts.blocks.length;
      renderTail(parts.tail);
    }

    /* One finished block, in its final form.

       Appended empty and filled when the provider resolves, so what the reader sees is
       in the order the blocks arrived even though rendering is asynchronous: every block
       of a turn awaits the same promise, and its callbacks run in the order they were
       registered. */
    function renderBlock(markdown) {
      var host = el('div', 'cp-draft-block');
      host.setAttribute('aria-busy', 'true');
      prose.insertBefore(host, tail);
      scene().then(function () { return proseMarkdown(markdown); }).then(function (html) {
        host.innerHTML = html;
        host.removeAttribute('aria-busy');
        decorateInert(host);
      }, function () {
        // No renderer yet, or it refused. The block is still true; it arrives as words
        // rather than as markup, and the settled answer replaces it a moment later.
        host.textContent = plain(markdown);
        host.removeAttribute('aria-busy');
      });
    }

    /* A block as words, for the fallback above and for nothing else. */
    function plain(markdown) {
      return window.CopilotDraft.segments(markdown).map(function (piece) {
        return piece.cite === undefined ? piece.text : piece.cite;
      }).join('');
    }

    /* The block that has not finished arriving.

       Its markup is still on the way — `##` may yet become `## Diagnosis`, a `**` may yet
       close — so it is drawn as text with the syntax removed, which is what
       `CopilotDraft.segments` decides. It is one element, replaced in place, so the
       reader watches a sentence finish rather than a node appear. */
    function renderTail(text) {
      if (!tail) {
        tail = el('span', 'cp-draft-tail');
        prose.appendChild(tail);
      }
      tail.textContent = '';
      window.CopilotDraft.segments(text).forEach(function (piece) {
        tail.appendChild(piece.cite === undefined
          ? document.createTextNode(piece.text)
          : markerPill(piece.cite));
      });
    }

    /* A citation marker during the draft. Not a control: there is nothing to open until
       the answer settles, and a button that opens nothing is worse than a marker that
       plainly is not one. */
    function markerPill(label) {
      var pill = el('span', 'cp-cite');
      pill.setAttribute('aria-hidden', 'true');
      pill.textContent = label;
      return pill;
    }

    /* Citation markers inside a finished block, as inert pills.

       The substitution the component makes once the answer settles, minus the
       interaction. Done on the rendered DOM rather than on the markdown source, because a
       marker sits mid-sentence: splitting the source would hand the renderer two
       half-paragraphs and it would close each of them. */
    function decorateInert(host) {
      var pattern = new RegExp(window.CopilotDraft.marker, 'gi');
      var walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      var targets = [];
      while (walker.nextNode()) {
        if (walker.currentNode.data.indexOf('^[') !== -1) targets.push(walker.currentNode);
      }
      targets.forEach(function (node) {
        var found = [];
        var match;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(node.data)) !== null) found.push(match);
        if (!found.length) return;
        var fragment = document.createDocumentFragment();
        var cursor = 0;
        found.forEach(function (marker) {
          fragment.appendChild(
            document.createTextNode(node.data.slice(cursor, marker.index)));
          fragment.appendChild(markerPill(marker[1]));
          cursor = marker.index + marker[0].length;
        });
        fragment.appendChild(document.createTextNode(node.data.slice(cursor)));
        node.parentNode.replaceChild(fragment, node);
      });
    }

    /* Take the draft away without ending the turn.

       For the run that went back for evidence: the model spoke, was sent to a tool or
       told to retrieve, and will answer again. The prose on screen belongs to the first
       pass and is not the answer — the answer is the last pass's — so it goes at the
       frame that says the run moved on, rather than being replaced by the settled answer
       a moment later. The reveal stays open: the next pass pours into this same turn,
       and its opening characters must not be painted underneath the tail of the abandoned
       one. */
    function abandonDraft() {
      reveal.discard();
      prose.textContent = '';
      streamed = '';
      committed = 0;
      tail = null;
    }

    /* Take the draft away, and stop the cadence feeding it.

       Called once the surface has crossed over, and by `say` — the one path that replaces
       the text outright. A character released after either of those would append to an
       answer that is no longer the draft. */
    function resetDraft() {
      reveal.cancel();
      prose.textContent = '';
      streamed = '';
      committed = 0;
      tail = null;
    }

    function appendProse(piece) {
      reveal.push(piece);
    }

    /* Whether this turn holds any prose at all, drawn or still queued. The caller needs
       the difference: a turn whose stream ended without an answer frame is a failure,
       but a turn with characters still waiting to be drawn is a draft, and treating it
       as a failure would replace a partial answer with an apology. */
    function hasProse() {
      return reveal.released > 0 || reveal.pending > 0;
    }

    /* Finish the pour, and resolve when the last character is on screen.

       Awaiting this before anything replaces the draft is the whole of the first defect:
       the settled answer used to overwrite a queue that was still a third full, so the
       reader was shown the beginning of a draft and then the whole answer. A turn read
       back from the store has nothing queued and this resolves without doing anything. */
    function flushProse() {
      return reveal.flush();
    }

    /* Lay the settled surface over the draft, and take the draft away.

       The two ways this goes wrong are both visible. Two copies of the answer stacked
       vertically, because both elements are in normal flow and both have height; or the
       answer briefly blank, because the draft was removed before the surface was drawn. So
       during the handover `.cp-answer` stacks its children in ONE grid cell — the draft
       underneath, the surface over it at opacity 0 — and the two cross-fade in place. When
       the fade ends the draft is emptied and the cell collapses back into normal flow, at
       a moment when nothing on screen is changing.

       The two frames before the fade are not ceremony. The surface has to be laid out
       before its opacity can animate against a cell of the right height, and a transition
       started in the same task as the append would start from a height that is still
       being computed. */
    function settle(surface) {
      if (!surface) {
        resetDraft();
        return Promise.resolve();
      }
      answerSection.classList.add('is-settling');
      return nextFrame()
        .then(nextFrame)
        .then(function () {
          // The same frame for both, which is the point: the surface begins to appear as
          // the draft begins to leave, never after it has gone.
          surface.classList.remove('cp-entering');
          prose.classList.add('cp-leaving');
          return reduceMotion.matches ? null : wait(SETTLE_MS);
        })
        .then(function () {
          resetDraft();
          prose.classList.remove('cp-leaving');
          answerSection.classList.remove('is-settling');
        });
    }

    /* What the server said about the prose it announced, once it settled. `visible`
       means a guardrail removed something from what the reader has just read.

       The wording is deliberately quiet and the detail is on the title. The previous
       text stated outright that part of the answer had been removed; that is the fact,
       but a full-width amber box stating it read as a hazard alarm for what is a routine
       reconciliation against the record. What has NOT changed is that the reader is
       told: the pill appears for this case and no other, and says on hover exactly what
       happened. */
    function settleProse(swap) {
      // A guardrail removed something from what the reader has just read, so the pill
      // says that whether or not the turn was also verified: the correction is the more
      // specific fact, and two pills in one slot would be one fact hidden behind the
      // other.
      if (swap !== 'visible') return;
      evidence.textContent = '🛡️ Reconciled with medical record';
      evidence.title =
        'Part of what was shown while this answer was being written was removed after it '
          + 'was checked against the record. The answer below is the verified version.';
      evidence.hidden = false;
    }

    /* That the answer was checked against — and grounded in — the patient record.

       One pill in the header, drawn for every turn the envelope marks `verified`, live
       or read back from the store. The title carries what was checked, because the
       sentence on the pill says the reassuring half and the reader is owed the specific
       one on hover. */
    function showVerified() {
      evidence.textContent = '🛡️ Verified against the chart';
      evidence.title =
        'This answer was checked against the patient record and rests on it: retrieved '
          + 'note text, a structured chart result, or the admission summary.';
      evidence.hidden = false;
    }

    /* Which composed narrative this turn is drawing, once it exists.

       The prose and its markers live inside two shadow roots — the A2UI surface's and
       the narrative's own — so this page cannot select into them and must not try. The
       component announces itself with a composed event when it first updates; that
       event crosses upward out of both boundaries and is the only thing this side
       learns about the renderer's internals. See `CitedNarrativeElement`'s
       `a2ui-cited-narrative-ready`.

       Null for a turn with no canvas: an answer that is prose only, a refusal, a
       failed request. Every caller tolerates it, because a drawer row exists on turns
       whose canvas drew nothing. */
    var narrative = null;
    root.addEventListener('a2ui-cited-narrative-ready', function (event) {
      narrative = (event.detail && event.detail.element) || null;
    });

    /* Show which sentence the passage just opened belongs to.

       The component does the showing — it owns the marker, the stylesheet and the
       1,400 ms — and returns false when there is nothing to reveal: a prose-only turn,
       or markers still inert because the answer is streaming. */
    function revealMarker(index) {
      if (!narrative) return;
      narrative.revealCitation(index);
    }

    /* The card's "See all references" — a request to be taken to the whole list.

       The card lives inside two shadow trees this page does not own and the list lives
       out here, so the card announces the intent with a composed event and the turn
       answers it. The event carries the index of the citation it was opened from, and that
       is the row to land on: a reader who asked about `5 · The Journal of Arthroplasty`
       wants row 5, not the top of a drawer holding five rows.

       The row is marked for a moment afterwards, because a smooth scroll ends somewhere
       and the reader has to be able to tell which of the rows it ended at. */
    var referenceMarkerTimer = null;
    function showReference(index) {
      if (references.hidden) return false;
      references.open = true;
      var target = null;
      if (index !== null && index !== undefined) {
        target = references.querySelector(
          '[data-reference-index="' + Number(index) + '"]');
      }
      centreIntoView(target || references);
      if (!target) return true;
      target.classList.add('is-target');
      clearTimeout(referenceMarkerTimer);
      referenceMarkerTimer = setTimeout(function () {
        target.classList.remove('is-target');
      }, 1600);
      // The caret travels with the view, so a keyboard reader arrives where the scroll
      // took them. The row's own control is focused rather than the drawer: the drawer's
      // summary would put them back above the row they just asked for.
      var control = target.querySelector('.cp-reference-head');
      if (control) control.focus({ preventScroll: true });
      return true;
    }

    root.addEventListener('citation-see-all', function (event) {
      showReference((event.detail || {}).index);
    });

    /* One row of the drawer, and the two kinds of evidence a reference record can carry.

       A published record is a destination: the identifier and the link are all a reader
       needs to go and read it, so the row opens a tab and stops there. Today this drawer
       is only given note passages — a literature turn draws its records in the canvas
       bibliography instead — so this branch is the general case rather than the reached
       one, and it exists so a record the contract allows cannot arrive as a broken row.

       A note passage cannot be a destination, because the passage is already in hand —
       the agent sent the text itself. So the row opens instead, showing the passage the
       answer was drawn from and pointing at the sentence it supports. A row that only
       named the section would be an audit trail that lists claims to go and check
       somewhere else, which is not an audit trail. */
    function referenceRow(row) {
      var item = el('li', 'cp-reference-item');
      var published = !!(row.url || row.pmid);
      // What a citation's "see all references" scrolls to. The number is already in the
      // gutter; this is the same number as an address rather than as text.
      item.dataset.referenceIndex = String(row.index);

      /* The number, once, in the row's own gutter. It used to be inside the label as
         `[1] Discharge note · …` beside a counter that rendered `1.`, and a reader saw
         `1. [1] Discharge note`. The row's index is a column now, so nothing has to
         agree with anything. */
      var mark = el('span', 'cp-reference-index');
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = (row.index === undefined ? '?' : row.index) + '.';

      /* What kind of source this is. A discharge note and a journal article are weighed
         differently — one is the patient's own record, the other is published evidence —
         and the row said so only in a word a reader had to parse out of the label. */
      var tag = el('span', 'cp-reference-tag');
      tag.textContent = published
        ? ('PubMed' + (row.year ? ' · ' + row.year : ''))
        : 'Clinical Note';

      /* A published record is a destination: the row opens a tab. A note passage cannot
         be one, because the passage is already in hand, so the row opens instead and
         shows the text the answer was drawn from. */
      var head;
      if (published) {
        head = document.createElement('a');
        head.className = 'cp-reference-head';
        head.href = row.url || ('https://pubmed.ncbi.nlm.nih.gov/' + row.pmid + '/');
        head.target = '_blank';
        head.rel = 'noopener';
      } else {
        head = document.createElement('button');
        head.type = 'button';
        head.className = 'cp-reference-head';
        head.setAttribute('aria-expanded', 'false');
      }
      var title = el('span', 'cp-reference-title');
      title.textContent = row.title || row.source || 'Source';
      head.append(title, tag);

      var main = el('div', 'cp-reference-main');
      main.appendChild(head);

      /* The citation line, for a record that has one: journal, year, authors, identifier.
         Without it a published row was a single line naming its journal — `5. The Journal
         of Arthroplasty · 2022` — with no paper, no authors and nothing to weigh it by,
         beside four note rows that each carried a passage. */
      if (row.subtitle) {
        var citationLine = el('div', 'cp-reference-subtitle');
        citationLine.textContent = String(row.subtitle);
        main.appendChild(citationLine);
      }

      if (row.excerpt) {
        var body = el('p', 'cp-reference-excerpt');
        body.textContent = String(row.excerpt);
        main.appendChild(body);
        // A note passage is expanded by its own row, clamped to two lines until then. A
        // published record's row is a link out, so its passage is shown and stays clamped:
        // the click on that row already has a destination.
        if (!published) {
          // The passage is on screen already, clamped to two lines. The click is what
          // unclamps it — and, as before, it is also what points at the sentence the
          // passage supports, so the row reads as provenance rather than as a menu item.
          head.addEventListener('click', function () {
            var opening = !item.classList.contains('is-open');
            item.classList.toggle('is-open', opening);
            head.setAttribute('aria-expanded', String(opening));
            if (opening) revealMarker(row.index);
          });
        }
      }

      item.append(mark, main);
      return item;
    }

    function presentReferences(rows) {
      // No rows means no drawer. An accordion that opens onto nothing promises
      // evidence and then shows its absence, which is worse than not offering it.
      if (!rows.length) {
        references.hidden = true;
        return;
      }
      var summary = document.createElement('summary');
      // One label, upper-cased by the stylesheet, rather than a count: the rows are
      // numbered now and a second number in the summary would be a count of the count.
      summary.textContent = 'References';
      references.appendChild(summary);
      // Open, because the rows ARE the evidence for an answer that cites them: a reader
      // checking a marker should not have to find a control first. The disclosure stays
      // so the row can be closed by a reader who wants the prose alone.
      references.open = true;
      var list = el('ol', 'cp-reference-list');
      rows.forEach(function (row) { list.appendChild(referenceRow(row)); });
      references.appendChild(list);
      references.hidden = false;
    }

    function presentFollowUps(questions) {
      if (!questions.length) return;
      var buttons = questions.map(function (question) {
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'cp-follow-up';
        var text = el('span', 'cp-follow-up-text');
        text.textContent = question;
        var chevron = el('span', 'cp-follow-up-chevron');
        chevron.setAttribute('aria-hidden', 'true');
        chevron.textContent = '›';
        row.append(text, chevron);
        // The chip says what it is. It was generated from a tool result this
        // conversation holds, so the agent can answer it from the transcript and must
        // not go back for evidence — and it cannot know that from the wording, because
        // the wording is the record's own ("…the abnormal discharge Red blood cells…").
        // Provenance is the one thing this side knows and the agent cannot infer.
        row.addEventListener('click', function () {
          askFollowUp(question, buttons, 'follow_up');
        });
        followUps.appendChild(row);
        return row;
      });
      followUps.hidden = false;
    }

    /* The chrome a turn carries besides its answer: what the answer rested on, the
       records its markers resolve to, and the next questions.

       Every field is defaulted, because a thread spans the change that introduced them:
       a turn stored before 4A-2 replays with none of the three, and it has to draw as an
       ordinary turn rather than as a broken one. `scope: null` in particular is a real
       value — a redirect rested on nothing — so it shows no pill rather than a guess.

       The references drawer is a CHART-turn affordance and is deliberately not drawn for
       a literature turn. A literature turn already has its primary evidence surface: the
       canvas draws the retrieved records themselves, with their journal, date and PMID
       links. Listing the same articles again in a drawer beneath that is the same
       evidence twice, and two renderings of one source read as two sources — which is
       exactly the misreading the citation contract exists to prevent. */
    function presentFacts(payload) {
      latest = payload;
      var scope = payload.scope || null;
      if (scope) {
        scopeEl.textContent = scope === 'patient_chart'
          ? 'Patient Chart Synthesis'
          : 'General Medical Evidence';
        scopeEl.hidden = false;
      }
      if (payload.routed_to) {
        // The server sends the wire name; the reader is owed the command they would
        // have typed. The two coincide for every routed command today (meds, labs).
        routedEl.textContent = '⚡ Routed to /' + payload.routed_to;
        routedEl.hidden = false;
      }
      /* That this answer was checked against, and grounded in, the patient record.

         Read from the envelope rather than inferred here. Which turns qualify is a
         clinical rule — a `/labs` answer rests on a trajectory, a `/meds` answer on an
         extraction verified against the note — and a second derivation in this file
         would be a second answer to the same question. An older payload has no field,
         which is why this is `=== true` rather than truthiness: `undefined` is a turn
         recorded before the field existed, not a turn that failed verification. */
      if (payload.verified === true) showVerified();
      // A note passage has no surface of its own — the canvas shows the answer, not the
      // notes it was drawn from — so on a chart turn the drawer is the only place the
      // passage behind a marker can be read, and it is the row that carries it.
      presentReferences(scope === 'patient_chart' ? (payload.references || []) : []);
      presentFollowUps(payload.follow_ups || []);
    }

    return {
      root: root,
      canvas: canvas,
      prose: prose,
      stage: stage,
      finish: finish,
      restore: restore,
      say: say,
      appendProse: appendProse,
      hasProse: hasProse,
      abandonDraft: abandonDraft,
      flushProse: flushProse,
      settle: settle,
      settleProse: settleProse,
      presentFacts: presentFacts,
      answer: function (message) { say(message || ''); },
    };
  }

  function turns() {
    return [].slice.call(feed.querySelectorAll('.cp-turn'));
  }

  // --- the A2UI renderer --------------------------------------------------------

  async function scene() {
    if (!rendererPromise) {
      if (!rendererUrl) throw new Error('no renderer url');
      rendererPromise = import(rendererUrl).then(function (module) {
        renderer = {
          module: module,
          MessageProcessor: module.MessageProcessor,
          // The clinical catalog, from the clinical bundle: it carries the Phase 2
          // components (RiskInfluencers, LiteratureList) that the agent's composer
          // now emits. The legacy risk catalog is not loaded at all, so a surface
          // naming a retired component would draw nothing rather than draw the old
          // widget — a mismatch that fails loudly in review instead of quietly in
          // production.
          catalog: module.buildClinicalCatalog(module.basicCatalog),
        };
        return renderer;
      });
    }
    return rendererPromise;
  }

  /* The markdown provider the surface reads, wrapped to space its paragraphs.

     The surface renders inside nested shadow roots, so no rule in `demo_shell.css` can
     reach the paragraphs it produces — and the element it emits carries no margin of
     its own, which is why consecutive sections rendered flush against each other. The
     spacing therefore has to travel with the HTML: an inline style is the one thing a
     shadow boundary does not filter.

     Applied after the renderer's own sanitizer has run, and to a literal this file owns
     — nothing that came from the model or the user passes through this substitution. */
  function proseMarkdown(value) {
    return renderer.module.renderMarkdown(value).then(function (html) {
      return String(html).replace(/<p>/g, '<p style="margin:0 0 0.75rem">');
    });
  }

  /* Mount one turn's envelope into that turn's canvas host.

     The markdown provider sits on the host: the basic Text component renders
     Markdown, and without a provider above it the prose arrives as raw text. One
     provider per turn, so no turn depends on another having been mounted first. */
  async function mountSurface(host, envelope) {
    var sceneRenderer = await scene();
    new sceneRenderer.module.ContextProvider(host, {
      context: sceneRenderer.module.Context.markdown,
      initialValue: proseMarkdown,
    });
    // A fresh processor per turn: reusing one would carry the previous surface into
    // the new one and draw both.
    var processor = new sceneRenderer.MessageProcessor([sceneRenderer.catalog]);
    var created = null;
    processor.onSurfaceCreated(function (surface) {
      var element = document.createElement('a2ui-surface');
      element.surface = surface;
      // Invisible until the draft has been handed over, and laid out anyway: the two
      // are cross-faded in one grid cell, so the surface's height has to count before
      // it can be seen. `createTurn`'s `settle` removes this class.
      element.classList.add('cp-entering');
      host.appendChild(element);
      created = element;
    });
    processor.processMessages(envelope.messages);
    return created;
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

  /* The frames of one run, read against that run's turn: a stage goes to the turn
     being watched, and `consume` returns the answer payload it saw, so no state about
     the run lives outside it. */
  async function consume(body, block) {
    var reader = body.getReader();
    var decoder = new TextDecoder();
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
        if (payload.text) block.appendProse(String(payload.text));
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
        if (remaining && payload.remaining !== undefined) {
          remaining.textContent = payload.remaining;
        }
        block.finish();
        block.say(payload.error || 'The clinical copilot is unavailable. Please try again.',
                  true);
        return;
      }
      // A stage frame's own wording, whatever the agent chose to call it.
      //
      // A stage that arrives after this turn has already drawn prose is the run going
      // back for evidence: the model spoke, was sent to a tool or told to retrieve, and
      // will answer again. What is on screen belongs to the first pass and is not the
      // answer, so it is dropped here, at the frame that says so — the reader watches the
      // run move on rather than watching a sentence arrive and be taken away.
      if (block.hasProse()) block.abandonDraft();
      var label = payload.label || payload.stage || name;
      if (label) block.stage(label);
    }

    for (;;) {
      var step = await reader.read();
      if (step.done) break;
      buffer += decoder.decode(step.value, { stream: true });
      // Split on the blank line that ends a frame, rather than assuming one chunk is
      // one frame: a chunk boundary can fall anywhere.
      var boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        frame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
    }
    if (buffer.trim()) frame(buffer);
    return { payload: answerPayload, swap: swap };
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

  // --- the thread list ----------------------------------------------------------

  async function send(hadmId) {
    // Taken before the first await: an affordance's declaration belongs to the submit
    // it caused, and a submission that suspends before reading it is one another
    // submission could take it from.
    var declared = declaredIntent;
    declaredIntent = '';

    // Before anything is sent: the thread on screen must be this patient's, and the
    // id sent must be that thread's.
    await window.CopilotThreads.syncToPatient(hadmId);

    var request = { hadm_id: Number(hadmId) };
    var threadId = window.CopilotThreads.conversationId();
    if (threadId) request.conversation_id = threadId;
    // Sent as its own field rather than folded into the wording, because the agent is
    // the one place that defines this vocabulary. This side does not decide what the
    // value means, and does not keep a list of which values exist.
    if (declared) request.intent = declared;

    // A `/` command names which question to ask, and the typed text is either that
    // command's own input or a separate question. Which one it is belongs to the
    // agent, which owns the command vocabulary; deciding here would be a second copy
    // of that table, and the copy is what gets it wrong. So both are sent when the
    // composer holds both, and the answer is a refusal when the two do not belong
    // together (ECC-22).
    var intent = intentField ? intentField.value : '';
    var typed = input ? input.value.trim() : '';
    if (intent) {
      request.chip = intent;
      // The field the composer owns already holds the command, so there is nothing to
      // write back: what a submit would send is in the DOM because the reader put it
      // there, not because the page decided it.
    }
    if (typed) request.question = typed;

    // The heading is read now and sent with the request, so the turn the store keeps
    // is headed with the words the reader saw. The server cannot reconstruct this: it
    // is handed an intent, not the vocabulary the console drew it from.
    var heading = askedFor();
    request.asked = heading;

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

    try {
      var response = await fetch(askUrl, {
        method: 'POST',
        // `Accept` is what selects the streaming shape of the response. The server
        // relays the chain's progress stages only to a caller that asks for an event
        // stream; without this header it answers with a single JSON object instead,
        // which is a silent downgrade rather than an error — the parser above then
        // finds no frames in it and the answer is discarded unread.
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'X-CSRFToken': csrfToken(),
        },
        body: JSON.stringify(Object.assign({}, request, { stream_prose: true, follow_ups: true })),
      });

      if (!response.ok) {
        var failure = await response.json().catch(function () { return {}; });
        block.finish();
        block.say(failure.error || 'The clinical copilot is unavailable. Please try again.',
                  true);
        if (response.status === 409) {
          // The thread this tab thought it was in has gone — swept, or deleted in
          // another tab. Re-reading the list is what puts the sidebar and the id back
          // in step with the store.
          window.CopilotThreads.forget();
          window.CopilotThreads.load();
        }
        return;
      }

      var settled = await consume(response.body, block);
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
      } else if (!block.hasProse()) {
        block.finish();
        block.say('The clinical copilot is unavailable. Please try again.', true);
      } else {
        // Prose arrived and no settled answer followed: the stream closed early. Both
        // branches above are skipped in that case — there is no answer payload, yet the
        // block does have prose — so NOTHING finished the turn and the composer stayed
        // pending with a half-written answer on screen and no error to explain it
        // (reported 2026-10-16 from an unrecognised slash command). Finishing is the
        // whole fix: the prose the reader already has is kept rather than replaced by a
        // generic failure, because the failure was in the transport, not the answer.
        block.finish();
      }
      // No scroll here. This line used to take the viewport to the turn's bottom the
      // moment the answer settled — after a long `/ehr` that is the end of the
      // references drawer, with the answer the reader came for somewhere above them.
      // The anchor set at submit (block:'start') is the whole policy: the turn's head
      // stays where it was put, and the answer grows downward from it.
    } catch (error) {
      block.finish();
      block.say('The clinical copilot is unavailable. Please try again.', true);
    }
  }

  // --- wiring ------------------------------------------------------------
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
     screen is `restore`, which uses the same pair a live answer uses.

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