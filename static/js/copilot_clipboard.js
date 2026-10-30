/* Enterprise Clinical Copilot — taking a turn's answer away from the page.

   Two controls, one behaviour each: put the answer on the clipboard, and export the table
   the turn drew. Both belong to the turn rather than to the answer, and both are offered
   only once the answer is final — a copy of an answer still being written is empty or
   half-composed, and neither is worth having.

   The rows come from `CopilotTSV.structuredRows` — read from the surface the agent
   composed rather than from the DOM, because the DOM is where those rows are drawn, not
   where they are defined. That is why the export decision lives here: this is the module
   that knows what an export would contain.

   Split out of `copilot_canvas.js` in Phase 5. */
(function () {
  'use strict';

  function create(options) {
    var el = options.el;
    var iconButton = options.iconButton;
    var flash = options.flash;
    var latestOf = options.latestOf;
    var textOf = options.textOf;
    var turnIdOf = options.turnIdOf;

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

    /* The turn's utility toolbar, opposite the title in the header.

       One toolbar per TURN rather than one per surface, because a unified `/ehr` turn
       carries two surfaces in one answer and two toolbars would be two places to look for
       the same two actions. It sits in the header rather than under the answer because
       these are actions on the answer as a whole, and the header is the part of a turn
       that outlives the run — the same reason the Evidence-Check notice lives here and
       the status row does not.

       Revealed when the turn is settled, because copying or exporting an answer that is
       still being written would either be empty or export a half-composed surface. */
    var toolbar = el('div', 'cp-turn-toolbar');
    toolbar.hidden = true;

    var copyAll = iconButton('fa-copy', 'Copy the answer');
    copyAll.addEventListener('click', function () { copyText(textOf(), copyAll); });

    /* Export, offered only when the turn drew a table.

       The file is tab-separated and named `.tsv` rather than `.csv`: a clinical value may
       contain a comma and may not contain a tab, so the delimiter cannot collide with a
       field and no quoting rule has to be invented here and kept in step with another one
       somewhere else. */
    var exportAll = iconButton('fa-download', 'Export this table', 'fa-solid');
    exportAll.hidden = true;
    exportAll.addEventListener('click', function () {
      var latest = latestOf();
      var rows = window.CopilotTSV.structuredRows(latest && latest.a2ui);
      if (!rows) { flash(exportAll, 'fa-solid fa-ban'); return; }
      var blob = new Blob([rows + '\n'],
                          { type: 'text/tab-separated-values;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      // Named for the turn, so two exports from one thread do not overwrite each other.
      link.download = 'ecc-turn-'
        + String(turnIdOf()).replace(/[^a-zA-Z0-9]+/g, '-') + '.tsv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      flash(exportAll, 'fa-solid fa-check');
    });

    toolbar.append(copyAll, exportAll);

    /* Whether this turn has anything to export. Decided when the turn settles rather than
       at click time, so the control does not appear and then refuse — and decided from
       the same function the click uses, so the two cannot disagree about what a table
       is. */
    function setExportable() {
      var latest = latestOf();
      exportAll.hidden = !window.CopilotTSV.structuredRows(latest && latest.a2ui);
    }

    return {
      toolbar: toolbar,
      copyAll: copyAll,
      exportAll: exportAll,
      setExportable: setExportable,
      copyText: copyText,
    };
  }

  window.CopilotClipboard = Object.freeze({ create: create });
})();
