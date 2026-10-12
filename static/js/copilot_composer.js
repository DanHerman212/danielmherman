/* Enterprise Clinical Copilot — the composer's `@` patient selector.

   Typing `@` opens a lookup over the local patient table. Choosing a row pins
   that admission to the composer as a pill beside the input, and clears the `@…`
   text that produced it.

   The chosen admission lives in the form's hidden `hadm_id` field rather than in
   this module's memory, so the value a submit will carry is the value in the DOM:
   one source of truth, inspectable, and assertable without this script running.

   Nothing is sent yet. The ask bar still cancels its submit; this wires the entry
   point that the ask path will read when it is wired.

   Plain JavaScript, deliberately: the component framework in this project is the
   A2UI renderer's, and it is reserved for agent-composed canvas messages. The
   shell's chrome is not a component tree and gains nothing from becoming one. */
(function () {
  'use strict';

  var form = document.getElementById('cp-ask');
  var input = document.getElementById('cp-ask-input');
  var list = document.getElementById('cp-patient-list');
  var pill = document.getElementById('cp-patient-pill');
  var label = document.getElementById('cp-patient-label');
  var clearButton = document.getElementById('cp-patient-clear');
  var hiddenId = document.getElementById('cp-patient-id');
  var commandList = document.getElementById('cp-command-list');
  var commandPill = document.getElementById('cp-command-pill');
  var commandLabel = document.getElementById('cp-command-label');
  var commandClear = document.getElementById('cp-command-clear');
  var intentField = document.getElementById('cp-command-intent');
  var commandData = document.getElementById('cp-command-data');
  if (!form || !input || !list || !pill || !label || !hiddenId) return;

  var lookupUrl = form.getAttribute('data-lookup-url');
  if (!lookupUrl) return;

  var DEBOUNCE_MS = 300;
  var MIN_CHARS = 2;
  var NOTHING_FOUND = 'No patient matches that name.';

  var results = [];
  var active = -1;
  var timer = null;
  var inFlight = null;

  function close() {
    list.hidden = true;
    list.textContent = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    results = [];
    active = -1;
  }

  // The `@` token immediately before the caret. Anchored to the caret, so an `@`
  // earlier in the sentence is not reopened by editing the text after it.
  function tokenBeforeCaret() {
    var upto = input.value.slice(0, input.selectionStart);
    var match = upto.match(/(?:^|\s)@([^@\s]*)$/);
    return match ? match[1] : null;
  }

  // Take the `@token` back out of the input, now that the pill says it instead.
  function consumeToken() {
    var upto = input.value.slice(0, input.selectionStart);
    var match = upto.match(/(?:^|\s)@([^@\s]*)$/);
    if (!match) return;
    var start = input.selectionStart - match[1].length - 1;
    input.value = input.value.slice(0, start) + input.value.slice(input.selectionStart);
    input.setSelectionRange(start, start);
  }

  function render() {
    list.textContent = '';

    if (!results.length) {
      var empty = document.createElement('li');
      empty.className = 'cp-patient-empty';
      empty.textContent = NOTHING_FOUND;
      list.appendChild(empty);
    } else {
      results.forEach(function (row, index) {
        var item = document.createElement('li');
        item.className = 'cp-patient';
        item.id = 'cp-patient-option-' + index;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', index === active ? 'true' : 'false');

        var name = document.createElement('span');
        name.className = 'cp-patient-name';
        name.textContent = row.display_name;

        var meta = document.createElement('span');
        meta.className = 'cp-patient-meta';
        meta.textContent = row.meta;

        item.appendChild(name);
        item.appendChild(meta);
        // mousedown rather than click: moving focus to the input on blur would
        // tear the list down before a click could land on it.
        item.addEventListener('mousedown', function (event) {
          event.preventDefault();
          choose(index);
        });
        list.appendChild(item);
      });
    }

    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', 'cp-patient-option-' + active);
    }
  }

  function choose(index) {
    var row = results[index];
    if (!row) return;
    hiddenId.value = row.hadm_id;
    label.textContent = '@' + row.display_name;
    pill.hidden = false;
    consumeToken();
    close();
    input.focus();
  }

  function clearPatient() {
    hiddenId.value = '';
    label.textContent = '';
    pill.hidden = true;
    input.focus();
  }

  function lookup(query) {
    // One request in flight at a time: a slow reply for `and` must not land after
    // the reply for `andre` and overwrite it.
    if (inFlight) inFlight.abort();
    inFlight = new AbortController();

    fetch(lookupUrl + '?q=' + encodeURIComponent(query), { signal: inFlight.signal })
      .then(function (response) {
        return response.ok ? response.json() : { results: [] };
      })
      .then(function (payload) {
        results = payload.results || [];
        active = results.length ? 0 : -1;
        render();
      })
      .catch(function () {
        // Aborted or unreachable. Leave the list as it stands rather than
        // reporting a failure the typist did not cause and cannot act on.
      });
  }

  input.addEventListener('input', function () {
    var query = tokenBeforeCaret();
    if (query === null || query.length < MIN_CHARS) {
      window.clearTimeout(timer);
      close();
      return;
    }
    window.clearTimeout(timer);
    timer = window.setTimeout(function () {
      lookup(query);
    }, DEBOUNCE_MS);
  });

  input.addEventListener('keydown', function (event) {
    if (list.hidden) {
      // Nothing of ours open: Escape clears a patient that is already pinned —
      // but not while the command menu is showing, because it owns the key then.
      if (event.key === 'Escape' && !pill.hidden
          && (!commandList || commandList.hidden)) {
        clearPatient();
      }
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!results.length) return;
      var step = event.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + results.length) % results.length;
      render();
      return;
    }

    if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      choose(active);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });

  // A click outside the bar dismisses the list, the way the shell's menus do.
  document.addEventListener('click', function (event) {
    if (list.hidden) return;
    if (form.contains(event.target)) return;
    close();
  });

  if (clearButton) clearButton.addEventListener('click', clearPatient);

  // ---------- the `/` command menu ----------
  //
  // The list is fixed, so unlike the patient lookup there is no request, no
  // debounce and no race. The chosen command is held the way the patient is: a
  // pill shows it and a hidden field carries the intent name, so nothing has to
  // be parsed back out of the text box.

  var commands = [];
  try {
    commands = JSON.parse(commandData.textContent) || [];
  } catch (error) {
    commands = [];
  }

  var matches = [];
  var commandActive = -1;

  function closeCommands() {
    if (!commandList) return;
    commandList.hidden = true;
    commandList.textContent = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    matches = [];
    commandActive = -1;
  }

  function renderCommands() {
    commandList.textContent = '';

    matches.forEach(function (entry, index) {
      var item = document.createElement('li');
      item.className = 'cp-command';
      item.id = 'cp-command-option-' + index;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', index === commandActive ? 'true' : 'false');

      var name = document.createElement('span');
      name.className = 'cp-command-name';
      name.textContent = '/' + entry.command;

      var description = document.createElement('span');
      description.className = 'cp-command-desc';
      description.textContent = entry.description;

      item.appendChild(name);
      item.appendChild(description);
      item.addEventListener('mousedown', function (event) {
        event.preventDefault();
        chooseCommand(index);
      });
      commandList.appendChild(item);
    });

    commandList.hidden = !matches.length;
    input.setAttribute('aria-expanded', matches.length ? 'true' : 'false');
    if (commandActive >= 0) {
      input.setAttribute('aria-activedescendant', 'cp-command-option-' + commandActive);
    }
  }

  function chooseCommand(index) {
    var entry = matches[index];
    if (!entry) return;
    intentField.value = entry.chip;
    commandLabel.textContent = '/' + entry.command;
    commandPill.hidden = false;
    input.value = '';
    closeCommands();
    input.focus();
  }

  if (commandList && commandPill && commandLabel && intentField && commandData) {
    input.addEventListener('input', function () {
      // A command is the whole of the input: a slash and then letters, nothing
      // else. A slash mid-sentence is a path or a ratio, not a command.
      var typed = /^\/([a-zA-Z]*)$/.exec(input.value);
      if (!typed) {
        closeCommands();
        return;
      }
      var prefix = typed[1].toLowerCase();
      matches = commands.filter(function (entry) {
        return entry.command.indexOf(prefix) === 0;
      });
      commandActive = matches.length ? 0 : -1;
      renderCommands();
    });

    input.addEventListener('keydown', function (event) {
      if (commandList.hidden) return;

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!matches.length) return;
        var step = event.key === 'ArrowDown' ? 1 : -1;
        commandActive = (commandActive + step + matches.length) % matches.length;
        renderCommands();
        return;
      }

      if (event.key === 'Enter' && commandActive >= 0) {
        event.preventDefault();
        chooseCommand(commandActive);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        closeCommands();
      }
    });

    document.addEventListener('click', function (event) {
      if (commandList.hidden) return;
      if (form.contains(event.target)) return;
      closeCommands();
    });

    if (commandClear) {
      commandClear.addEventListener('click', function () {
        intentField.value = '';
        commandLabel.textContent = '';
        commandPill.hidden = true;
        input.focus();
      });
    }

    // A command is sent once. The canvas asks for this after it has read the
    // intent, so the pill is cleared by the send rather than by a timer: leaving
    // it pinned makes the next typed question arrive as a command AND a question,
    // which the server refuses (it can only answer one of the two). The patient
    // pill is untouched — the admission is what the next question is about.
    form.addEventListener('cp:command-consumed', function () {
      intentField.value = '';
      commandLabel.textContent = '';
      commandPill.hidden = true;
    });
  }
})();
