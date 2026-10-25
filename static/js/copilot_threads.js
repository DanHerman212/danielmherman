/* Enterprise Clinical Copilot — the thread list, and which thread this tab is in.

   The sidebar, its row menu, the stored-thread restore path, and the two facts that
   outlive a single turn: the conversation on screen and the patient it belongs to.

   Split out of `copilot_canvas.js`, which had the feed and the list in one closure.
   The seam between them is small and is the whole interface:

     this file -> feed   `feed.clear()`, `feed.restore(turns)`, `feed.patient()`,
                         `feed.context()`, `feed.scrollTo()`, `feed.turns()`,
                         `feed.dropPin()`, `feed.focusInput()`
     feed -> this file   `CopilotThreads.syncToPatient()`, `.conversationId()`,
                         `.remember()`, `.forget()`, `.load()`

   `feed` is read from `window.CopilotFeed` at CALL time, not here, because this file
   loads first and the feed does not exist yet. Nothing is cached.

   Two-space module scope, like every script on this page: `test_ux_restoration.py`
   asserts that indentation, because a nested definition here once threw on every
   click before anything was sent. */

(function () {
  'use strict';

  var feed = document.getElementById('cp-feed');
  var threadList = document.getElementById('cp-thread-list');
  var threadsEmpty = document.getElementById('cp-threads-empty');
  var newButton = document.getElementById('cp-new-btn');
  var searchButton = document.getElementById('cp-search-btn');
  var searchRow = document.getElementById('cp-thread-search');
  var filterInput = document.getElementById('cp-thread-filter');
  var patientClear = document.getElementById('cp-patient-clear');
  var input = document.getElementById('cp-ask-input');
  if (!feed || !threadList) return;

  var historyUrl = feed.getAttribute('data-history-url');

  /* The thread this tab is in, and the patient it belongs to. Both live here because
     they are facts about the thread rather than about the feed: a request sends the
     id and the admission, and the two have to agree or the server refuses the turn. */
  var conversationId = null;
  var loadedHadm = null;

  /* The list as last read from the store. Held so filtering is a re-render rather
     than a request per keystroke. */
  var threadEntries = [];

  /* `sessionStorage` rather than `localStorage`: a conversation is one patient's
     record and the site is a clinical tool, so two tabs are two threads and closing
     the tab should not leave an admission pinned to the next visit. */
  var CONVERSATION_KEY = 'cp.conversation';

  function canvas() {
    return window.CopilotFeed;
  }

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
    var base = canvas().conversationUrl(entry.conversation_id);
    if (!base) return null;
    try {
      var response = await fetch(base + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': canvas().csrfToken(),
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

  /* Emptying the feed is `canvas().clear()` at every call site, because the feed is
     the module that owns it. This module adds the one thing the feed cannot know
     about: a row menu may still be open against a row that is about to be replaced. */

  /* One stored turn, drawn by the same pair that draws a live one. The stage list
     stays empty: the run is over, and replaying the stages it passed through would be
     a re-enactment rather than a record. */
  async function restoreConversation(payload) {
    canvas().clear(); closeRowMenu();
    var stored = payload.turns || [];
    for (var index = 0; index < stored.length; index += 1) {
      var block = createTurn(stored[index].asked);
      await fillTurn(block, stored[index]);
      block.restore();
    }
    rememberConversation(payload.conversation_id);
    loadedHadm = payload.hadm_id;
    canvas().patient(payload.patient, payload.hadm_id);
    canvas().context(payload.expires_at);
    markActiveThread();
    return stored.length;
  }

  /* Open a stored thread. Nothing is answered here and no credit is spent: this is
     the store handing back what it already holds. */
  async function openConversation(pk, options) {
    var url = canvas().conversationUrl(pk);
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
      var blocks = canvas().turns();
      if (scroll && blocks.length) canvas().scrollTo(blocks[blocks.length - 1]);
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
    canvas().clear(); closeRowMenu();
    canvas().clearContext();
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
    canvas().clear(); closeRowMenu();
    // Dropping the pin goes through the composer's own control rather than reaching
    // into its state: the composer owns the pill and the hidden field, and a second
    // writer to them is how the two come to disagree.
    canvas().dropPin();
    canvas().clearContext();
    markActiveThread();
    canvas().focusInput();
  }

  // --- sending ------------------------------------------------------------------

  /* Boot: the list, then the thread this tab was in. Both are read on load so a
     reload continues where the reader was and the sidebar is populated immediately
     rather than behind a control. */
  function start() {
    loadThreads().then(function () {
      var previous = storedConversation();
      if (previous) openConversation(previous);
    });
  }

  window.CopilotThreads = Object.freeze({
    start: start,
    load: loadThreads,
    syncToPatient: syncToPatient,
    conversationId: function () { return conversationId; },
    remember: function (pk, hadmId) {
      rememberConversation(pk);
      loadedHadm = hadmId === undefined ? null : Number(hadmId);
    },
    forget: function () {
      rememberConversation(null);
      loadedHadm = null;
    },
    newConversation: newConversation,
  });

  newButton && newButton.addEventListener('click', newConversation);

  if (searchButton) {
    searchButton.addEventListener('click', function () {
      setSearchOpen(searchButton.getAttribute('aria-expanded') !== 'true');
    });
  }

  if (filterInput) {
    // Filtered as it is typed, over the list already in hand. The alternative -- a
    // request per keystroke -- would answer a question the browser can already answer,
    // and answer it later.
    filterInput.addEventListener('input', renderThreads);
  }

  // The menu is placed against the button, so anything that moves the button closes
  // it: it would otherwise be left pointing at where the row used to be.
  threadList.addEventListener('scroll', closeRowMenu, { passive: true });
  window.addEventListener('resize', closeRowMenu);
  document.addEventListener('click', closeRowMenu);
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    closeRowMenu();
    if (filterInput && filterInput.value) setSearchOpen(false);
  });
})();
