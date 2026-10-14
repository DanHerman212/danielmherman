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
  var retentionDays = feed.getAttribute('data-retention-days');
  if (!askUrl) return;

  var renderer = null;          // resolved on the first answer, then reused
  var rendererPromise = null;   // one import, however many turns ask for it
  var inFlight = false;

  /* The thread on screen, and the patient it belongs to. Both are kept because a
     request sends the id and the admission, and the two have to agree: the server
     refuses a turn that would land in another patient's thread, which is the right
     refusal and a bad one to earn by accident. */
  var conversationId = null;
  var loadedHadm = null;

  /* The sidebar's list as last read from the store. Held so filtering is a re-render
     rather than a request per keystroke: the list is bounded by the retention window
     and a few dozen rows long, so the whole of it is already here. */
  var threadEntries = [];

  /* The thread this tab is in, and where it is kept.

     `sessionStorage` rather than `localStorage`: a conversation is one patient's
     record and the site is a clinical tool, so two tabs are two threads and closing
     the tab should not leave an admission pinned to the next visit. A reload keeps
     its place, which is the thing that was missing. */
  var CONVERSATION_KEY = 'cp.conversation';

  function rememberConversation(pk) {
    conversationId = pk;
    try {
      if (pk) window.sessionStorage.setItem(CONVERSATION_KEY, String(pk));
      else window.sessionStorage.removeItem(CONVERSATION_KEY);
    } catch (error) {
      // A browser with storage disabled still gets a working page; it just does not
      // survive a reload, and saying so would be a worse interruption than the
      // limitation.
    }
  }

  function storedConversation() {
    try {
      var raw = window.sessionStorage.getItem(CONVERSATION_KEY);
      return raw ? Number(raw) : null;
    } catch (error) {
      return null;
    }
  }

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

  /* Smooth, unless the reader has asked their system not to be moved around. */
  function scrollIntoView(node) {
    if (!node || !node.scrollIntoView) return;
    var reduce = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ block: 'end', behavior: reduce ? 'auto' : 'smooth' });
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

  /* The commands the `/` menu offers, from the one list the server owns. */
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

  // --- one turn -----------------------------------------------------------------

  /* One turn: the question, whatever that turn drew, and the run while it runs.

     Everything the turn needs later is closed over rather than looked up again, so
     two turns cannot reach into each other, and nothing in here is addressed by a
     page-wide id — a conversation holds several canvases and several status rows at
     once. */
  function createTurn(asked) {
    var root = el('article', 'cp-turn');

    // A heading, not a toggle. A clinician must never have to click to read an
    // earlier turn, so there is nothing here to click: the question is text, and the
    // stylesheet pins it to the top of the scroll area while its answer passes
    // beneath it.
    var head = el('header', 'cp-turn-head');
    var title = document.createElement('h2');
    title.className = 'cp-turn-title';
    title.textContent = asked || '';
    head.appendChild(title);

    var body = el('div', 'cp-turn-body');
    var answerSection = el('section', 'cp-answer');
    var canvas = el('div', 'cp-canvas');
    var prose = el('div', 'cp-answer-text');
    /* The Evidence-Check notice, present in every turn and shown only by the one case
       that earns it. It lives here rather than in the footer because the footer is
       retired when the run ends, and this note is about the answer that outlives the
       run — a correction the reader has to still be able to see after the fact. */
    var evidence = el('div', 'cp-evidence');
    evidence.setAttribute('role', 'status');
    evidence.hidden = true;
    answerSection.append(canvas, prose, evidence);
    body.appendChild(answerSection);

    /* The run, while it is running. The dots say it is still going and the label
       says where it is; each stage replaces the label as it arrives, so what the
       reader sees is the run's latest news rather than a log of it.

       There is no control here and no list behind one. The list that used to open
       from this row was only reachable once the run had finished, and a finished turn
       now carries no row at all — so a disclosure would have had nothing to reveal
       and nothing to open it. A live region is what this actually is. */
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
    function retire() {
      if (foot.parentNode) foot.remove();
    }

    function stage(label) {
      if (label === statusText.textContent) return;
      statusText.textContent = label;
      // Restart the fade, so a replaced stage reads as replaced even when the two
      // arrive a moment apart.
      statusText.style.animation = 'none';
      void statusText.offsetWidth;
      statusText.style.animation = '';
    }

    function finish() {
      retire();
    }

    /* A turn that came back from the store. Its row is not merely empty, it is
       absent: the run it records finished days ago, and the progress it passed
       through was never stored. */
    function restore() {
      retire();
    }

    function say(message, isError) {
      prose.textContent = message;
      if (isError) prose.classList.add('cp-answer-error');
      // No correction to the status row here: every path that reports a failure also
      // finishes the turn, and finishing retires the row. Writing "Not answered" into
      // a detached node would be a line that runs and does nothing.
    }

    /* The answer as it is written. `say` replaces, which is what a settled answer
       needs; a delta appends, which is what a stream of them needs. Both write the same
       node, so the reader watches one body of text grow rather than a second one
       appear beside it — and the settled answer overwrites the lot, so a delta that
       arrived after the answer cannot survive it. */
    function appendProse(piece) {
      prose.appendChild(document.createTextNode(piece));
    }

    /* What the server said about the prose it announced, once it settled. `visible`
       means a guardrail removed something from what the reader has just read. */
    function settleProse(swap) {
      if (swap !== 'visible') return;
      evidence.textContent = 'Corrected after verification: part of what was shown while '
        + 'this answer was being written was removed.';
      evidence.hidden = false;
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
      settleProse: settleProse,
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

  /* Mount one turn's envelope into that turn's canvas host.

     The markdown provider sits on the host: the basic Text component renders
     Markdown, and without a provider above it the prose arrives as raw text. One
     provider per turn, so no turn depends on another having been mounted first. */
  async function mountSurface(host, envelope) {
    var sceneRenderer = await scene();
    new sceneRenderer.module.ContextProvider(host, {
      context: sceneRenderer.module.Context.markdown,
      initialValue: sceneRenderer.module.renderMarkdown,
    });
    // A fresh processor per turn: reusing one would carry the previous surface into
    // the new one and draw both.
    var processor = new sceneRenderer.MessageProcessor([sceneRenderer.catalog]);
    processor.onSurfaceCreated(function (surface) {
      var element = document.createElement('a2ui-surface');
      element.surface = surface;
      host.appendChild(element);
    });
    processor.processMessages(envelope.messages);
  }

  /* Fill a turn from the canonical payload — the same shape a stored turn is
     restored with, which is what keeps one renderer for both.

     The surface draws the prose itself when it carries the cited narrative, and the
     envelope says so with `renders_prose`; writing the answer here as well would
     print it twice, once with nothing clickable. The prose element stays because it
     is where an error, a refusal, or a turn with no canvas is written. */
  async function fillTurn(block, payload) {
    var envelope = payload.a2ui || null;
    var drawsProse = !!(envelope && envelope.renders_prose);
    if (!drawsProse) {
      block.answer(payload.answer || '');
    } else {
      // The surface is drawing the prose, so the streamed draft has to go. The guard
      // above only stops a SECOND write to this element; it cannot remove text the
      // deltas already put there, and a turn that streamed would otherwise show the
      // answer twice — once cited and clickable, once as raw prose with bare `^[1]`
      // markers beside it. Emptying it is enough: `:empty` hides the element.
      block.answer('');
    }
    if (envelope && envelope.messages) {
      // A composed surface is a bonus on top of the prose: if the renderer cannot
      // mount, the answer the clinician needs is already on screen.
      try {
        await mountSurface(block.canvas, envelope);
      } catch (error) {
        console.error('a2ui: the composed surface could not be drawn', error);
      }
    }
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

  function entryForHadm(hadmId) {
    var wanted = Number(hadmId);
    var found = null;
    threadEntries.forEach(function (entry) {
      if (!found && entry.hadm_id === wanted) found = entry;
    });
    return found;
  }

  async function loadThreads() {
    if (!historyUrl || !threadList) return;
    try {
      var response = await fetch(historyUrl, {
        headers: { 'Accept': 'application/json' },
      });
      if (!response.ok) throw new Error('threads ' + response.status);
      var body = await response.json();
      threadEntries = body.conversations || [];
      renderThreads();
    } catch (error) {
      // The conversation itself is unaffected by the list failing to load, so this is
      // logged rather than written into the feed: an error about the sidebar is not an
      // error about the answer.
      console.error('copilot: the thread list could not be loaded', error);
    }
  }

  function renderThreads() {
    if (!threadList) return;
    // The open menu belongs to a row that is about to be replaced.
    closeRowMenu();
    var needle = ((filterInput && filterInput.value) || '').trim().toLowerCase();
    var shown = needle
      ? threadEntries.filter(function (entry) {
          return entry.patient.toLowerCase().indexOf(needle) !== -1;
        })
      : threadEntries;

    threadList.textContent = '';
    shown.forEach(function (entry) {
      threadList.appendChild(threadRow(entry));
    });

    if (threadsEmpty) {
      // Only ever the "nothing matches" message. An empty list says nothing: a reader
      // who has not asked anything yet is looking at a sidebar with a composer beside
      // it, and a paragraph explaining what will appear there is the interface talking
      // about itself.
      threadsEmpty.hidden = !needle || shown.length > 0;
      threadsEmpty.textContent = 'No patient matches \u201c' + needle + '\u201d.';
    }
    markActiveThread();
  }

  /* One row: the patient's name, and a menu.

     The name is the patient's, always. A pin lifts a thread to the top of the list
     and does not rename it: nothing a thread is given replaces the patient it is
     about, because the patient is how the reader finds it again. */
  function threadRow(entry) {
    var item = document.createElement('li');
    item.className = 'cp-thread';

    var open = document.createElement('button');
    open.type = 'button';
    open.className = 'cp-thread-open';
    open.setAttribute('data-thread', String(entry.conversation_id));
    if (entry.pinned) {
      // A pinned thread is ordered to the top, and this says why it is there. It is
      // the only mark a row carries, because it is the only one that changes what the
      // reader would otherwise have to work out from the order alone.
      var pin = el('i', 'fa-solid fa-thumbtack cp-thread-pin');
      pin.setAttribute('aria-hidden', 'true');
      open.appendChild(pin);
    }
    var label = el('span', 'cp-thread-name');
    label.textContent = entry.patient;
    open.appendChild(label);
    open.addEventListener('click', function () {
      closeRowMenu();
      openConversation(entry.conversation_id);
    });
    item.appendChild(open);

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'cp-thread-menu-btn';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Actions for ' + entry.patient);
    toggle.title = 'More';
    var glyph = el('i', 'fa-solid fa-ellipsis-vertical');
    glyph.setAttribute('aria-hidden', 'true');
    toggle.appendChild(glyph);
    toggle.addEventListener('click', function (event) {
      event.stopPropagation();
      openRowMenu(entry, toggle);
    });

    var wrap = el('div', 'cp-thread-menu-wrap');
    wrap.appendChild(toggle);
    item.appendChild(wrap);
    return item;
  }

  /* ---- the row menu ----------------------------------------------------------
     One menu for the whole list, attached to the document rather than to the row it
     was opened from.

     It used to be built inside the row, which is why it came out half off the screen:
     the thread list is a scroll container, and a scroll container clips its
     absolutely positioned descendants. The menu opened downward into the rows below
     and the list cut it off at its own edge. A menu that belongs to a row cannot
     escape the row's containers, so this one does not belong to a row — it is fixed
     to the viewport, placed beside the control that opened it, and no ancestor can
     clip it or cover it. */
  var rowMenu = null;
  var rowMenuButton = null;

  function rowMenuEl() {
    if (rowMenu) return rowMenu;
    rowMenu = el('div', 'cp-row-menu');
    rowMenu.hidden = true;
    rowMenu.setAttribute('role', 'menu');
    document.body.appendChild(rowMenu);
    return rowMenu;
  }

  function closeRowMenu() {
    if (rowMenuButton) {
      rowMenuButton.setAttribute('aria-expanded', 'false');
      rowMenuButton = null;
    }
    if (rowMenu) rowMenu.hidden = true;
  }

  function menuChoice(text, className, run) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'cp-row-menu-item' + (className ? ' ' + className : '');
    button.textContent = text;
    button.setAttribute('role', 'menuitem');
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      run();
    });
    return button;
  }

  /* To the right of the dots, which is where the eye already is, and inside the
     window. The menu is fixed, so these are viewport coordinates and there is no
     ancestor to convert them against. */
  function placeRowMenu(host, button) {
    var at = button.getBoundingClientRect();
    // Placed at the origin first: a box has to be laid out before it can be measured,
    // and a hidden element has no size to measure.
    host.style.left = '0px';
    host.style.top = '0px';
    var box = host.getBoundingClientRect();
    var left = at.right + 6;
    var top = at.top;
    if (top + box.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - 8 - box.height);
    }
    if (left + box.width > window.innerWidth - 8) {
      // No room on the right: the sidebar is against the edge of a narrow window.
      // Back over the list rather than off the screen.
      left = Math.max(8, at.left - box.width - 6);
    }
    host.style.left = left + 'px';
    host.style.top = top + 'px';
  }

  function openRowMenu(entry, button) {
    var host = rowMenuEl();
    // Clicking the control that opened the menu closes it, rather than reopening it
    // a pixel away from where it already was.
    var wasOpen = rowMenuButton === button;
    closeRowMenu();
    if (wasOpen) return;

    host.textContent = '';
    host.appendChild(menuChoice(entry.pinned ? 'Unpin' : 'Pin', null, function () {
      closeRowMenu();
      setPinned(entry, !entry.pinned);
    }));
    host.appendChild(menuChoice('Delete', 'cp-row-menu-danger', function () {
      confirmDelete(entry, button);
    }));

    host.hidden = false;
    placeRowMenu(host, button);
    button.setAttribute('aria-expanded', 'true');
    rowMenuButton = button;
  }

  /* Two steps rather than a modal. A confirm dialog is a browser box over a clinical
     tool, and the question it asks — "are you sure?" — is answered better by the row
     itself disappearing than by a paragraph about it. */
  function confirmDelete(entry, button) {
    var host = rowMenuEl();
    host.textContent = '';
    var line = el('p', 'cp-row-menu-prompt');
    line.textContent = 'Delete this thread?';
    host.appendChild(line);
    host.appendChild(menuChoice('Delete', 'cp-row-menu-danger', function () {
      closeRowMenu();
      deleteThread(entry);
    }));
    host.appendChild(menuChoice('Cancel', null, function () {
      // Back to the menu rather than shut: cancelling the confirmation is not the
      // same as dismissing the menu, and shutting it would make the reader reopen it
      // to do the thing they came for.
      closeRowMenu();
      openRowMenu(entry, button);
    }));
    // The confirmation is a different size from the menu it replaced, so it is placed
    // again rather than left where the other one ended.
    placeRowMenu(host, button);
  }

  async function threadAction(entry, path, body) {
    var base = conversationUrl(entry.conversation_id);
    if (!base) return null;
    try {
      var response = await fetch(base + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrfToken(),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(path + ' ' + response.status);
      return await response.json();
    } catch (error) {
      console.error('copilot: the thread could not be updated', error);
      // The list is the thing that was guessed at, so it is re-read from the store
      // rather than left showing the change that did not happen.
      loadThreads();
      return null;
    }
  }

  async function setPinned(entry, pinned) {
    if (await threadAction(entry, 'pin/', { pinned })) loadThreads();
  }

  async function deleteThread(entry) {
    if (!(await threadAction(entry, 'delete/', {}))) return;
    // A thread that was on screen and has just been deleted is not a thread, so the
    // canvas goes back to empty rather than showing text the store will not answer
    // for.
    if (entry.conversation_id === conversationId) newConversation();
    loadThreads();
  }

  /* Which row is the thread on screen. Marked after every render, because a render
     and a change of thread can happen in either order. */
  function markActiveThread() {
    if (!threadList) return;
    [].forEach.call(threadList.querySelectorAll('.cp-thread-open'), function (open) {
      if (Number(open.getAttribute('data-thread')) === conversationId) {
        open.setAttribute('aria-current', 'true');
      } else {
        open.removeAttribute('aria-current');
      }
    });
  }

  function setSearchOpen(open) {
    if (!searchRow || !searchButton) return;
    searchRow.hidden = !open;
    searchButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      if (filterInput) filterInput.focus();
    } else if (filterInput && filterInput.value) {
      filterInput.value = '';
      renderThreads();
    }
  }

  // --- the stored thread --------------------------------------------------------

  function clearFeed() {
    feed.textContent = '';
    closeRowMenu();
  }

  /* One stored turn, drawn by the same pair that draws a live one. The stage list
     stays empty: the run is over, and replaying the stages it passed through would be
     a re-enactment rather than a record. */
  async function restoreConversation(payload) {
    clearFeed();
    var stored = payload.turns || [];
    for (var index = 0; index < stored.length; index += 1) {
      var block = createTurn(stored[index].asked);
      await fillTurn(block, stored[index]);
      block.restore();
    }
    rememberConversation(payload.conversation_id);
    loadedHadm = payload.hadm_id;
    setPatient(payload.patient, payload.hadm_id);
    updateContext(payload.expires_at);
    markActiveThread();
    return stored.length;
  }

  /* Open a stored thread. Nothing is answered here and no credit is spent: this is
     the store handing back what it already holds. */
  async function openConversation(pk, options) {
    var url = conversationUrl(pk);
    if (!url) return;
    var scroll = !options || options.scroll !== false;
    try {
      var response = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!response.ok) {
        // A thread the store will no longer answer for — swept, deleted, or another
        // account's. The id goes rather than being retried, because retrying a
        // refusal is how a stale id becomes a loop.
        rememberConversation(null);
        loadedHadm = null;
        loadThreads();
        return;
      }
      await restoreConversation(await response.json());
      var blocks = turns();
      if (scroll && blocks.length) scrollIntoView(blocks[blocks.length - 1]);
    } catch (error) {
      console.error('copilot: that conversation could not be restored', error);
    }
  }

  /* Put the canvas on the patient the composer is pinned to.

     The store keeps one thread per patient, so the composer's pill and the thread on
     screen have to agree before a question is sent: the server refuses a turn that
     would land in another patient's thread, and earning that refusal by accident is a
     bad way to learn it. Asking about a patient nobody has asked about yet leaves the
     canvas empty rather than showing the previous patient's text under the new
     patient's name. */
  async function syncToPatient(hadmId) {
    var wanted = Number(hadmId);
    if (loadedHadm === wanted) return;
    var entry = entryForHadm(wanted);
    if (entry) {
      await openConversation(entry.conversation_id, { scroll: false });
      return;
    }
    clearFeed();
    clearContext();
    rememberConversation(null);
    loadedHadm = wanted;
    markActiveThread();
  }

  /* A new conversation is an empty canvas and no patient pinned: the feed, the id,
     the pill and the context bar all go together, because an empty feed that still
     carried the last admission would open the next turn against the wrong patient.

     Note what this is not. The store holds one thread per patient, so this does not
     create a thread — picking a patient is what does that, and picking a patient
     already asked about continues theirs. What this clears is the composer and the
     view, which is what a reader pressing it is asking for. */
  function newConversation() {
    rememberConversation(null);
    loadedHadm = null;
    clearFeed();
    // Dropping the pin goes through the composer's own control rather than reaching
    // into its state: the composer owns the pill and the hidden field, and a second
    // writer to them is how the two come to disagree.
    if (patientClear) patientClear.click();
    clearContext();
    markActiveThread();
    if (input) input.focus();
  }

  // --- sending ------------------------------------------------------------------

  async function send(hadmId) {
    // Before anything is sent: the thread on screen must be this patient's, and the
    // id sent must be that thread's.
    await syncToPatient(hadmId);

    var request = { hadm_id: Number(hadmId) };
    if (conversationId) request.conversation_id = conversationId;

    // A `/` command names which question to ask, and the typed text is either that
    // command's own input or a separate question. Which one it is belongs to the
    // agent, which owns the command vocabulary; deciding here would be a second copy
    // of that table, and the copy is what gets it wrong. So both are sent when the
    // composer holds both, and the answer is a refusal when the two do not belong
    // together (ECC-22).
    var intent = intentField ? intentField.value : '';
    var typed = input ? input.value.trim() : '';
    // A patient selected with nothing typed is still a submission, and the default
    // action is the risk assessment. It goes as the COMMAND rather than as a question
    // about risk: a question runs the free-text loop, which no longer holds the risk
    // tool (UX Phase 1B), so that path could not answer it.
    if (!intent && !typed) intent = 'risk';
    if (intent) {
      request.chip = intent;
      // Written back into the field the composer owns before the heading reads it.
      // The template's contract for that field is that what a submit would send is in
      // the DOM — and the default above is a decision made here, so leaving it in a
      // local variable alone would make the heading of the turn it just sent
      // unreadable. It is cleared again immediately after, with the rest of the
      // consumed composer state.
      if (intentField && !intentField.value) intentField.value = intent;
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
        body: JSON.stringify(Object.assign({}, request, { stream_prose: true })),
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
          rememberConversation(null);
          loadedHadm = null;
          loadThreads();
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
          rememberConversation(answerPayload.conversation_id);
          loadedHadm = Number(hadmId);
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
        loadThreads();
      } else if (!block.prose.textContent) {
        block.finish();
        block.say('The clinical copilot is unavailable. Please try again.', true);
      }
      scrollIntoView(block.root);
    } catch (error) {
      block.finish();
      block.say('The clinical copilot is unavailable. Please try again.', true);
    }
  }

  // --- wiring -------------------------------------------------------------------

  if (newButton) newButton.addEventListener('click', newConversation);

  if (searchButton) {
    searchButton.addEventListener('click', function () {
      setSearchOpen(searchButton.getAttribute('aria-expanded') !== 'true');
    });
  }

  if (filterInput) {
    // Filtered as it is typed, over the list already in hand. The alternative — a
    // request per keystroke — would answer a question the browser can already answer,
    // and answer it later.
    filterInput.addEventListener('input', renderThreads);
  }

  // The menu is placed against the button, so anything that moves the button closes
  // it: it would otherwise be left pointing at where the row used to be.
  if (threadList) threadList.addEventListener('scroll', closeRowMenu, { passive: true });
  window.addEventListener('resize', closeRowMenu);

  document.addEventListener('click', closeRowMenu);
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    closeRowMenu();
    if (filterInput && filterInput.value) setSearchOpen(false);
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (inFlight) return;

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

  /* Where the tab left off, and the list it left off in. Both are read on load: the
     thread so a reload continues it, and the list so the sidebar is populated
     immediately rather than behind a control. */
  updateContext(null);
  loadThreads().then(function () {
    var previous = storedConversation();
    if (previous) openConversation(previous);
  });
})();
