/* Enterprise Clinical Copilot — the run, while it is running, and after it stops.

   The status row says where the run is; the labels it passed through become a collapsed
   disclosure under the header once the run ends; and a failure is stated where the
   reader is looking rather than in a banner somewhere else.

   Split out of `copilot_canvas.js` in Phase 5. What it needs from the answer is state it
   does not own — whether any prose has been drawn, and how to stop the cadence — so the
   turn hands it those four operations instead of reaching into it. */
(function () {
  'use strict';

  function create(options) {
    var el = options.el;
    var root = options.root;
    var body = options.body;
    var prose = options.prose;
    var answer = options.answer;
    var onSettled = options.onSettled;

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

    var notice = null;

    /* A run that stopped midway, with the reader already reading it.

       Two things are true at once and the draft handling has to honour both: what is
       on screen arrived correctly and is kept, and what is still queued arrived before
       the failure and belongs to the same answer, so it is drawn rather than dropped.
       Only then is the queue stopped. The notice is a pill under the prose, not a
       banner over the turn — it qualifies the text above it and does not replace it. */
    function interrupt(message) {
      // What is still queued arrived before the failure and belongs to the same answer,
      // so it is drawn rather than dropped. Only then does the cadence stop — and the
      // draft is emphatically not reset, because the text already on screen is the
      // part of the answer the reader has done the work of reading.
      answer.drainNow();
      answer.cancelReveal();
      if (!notice) {
        notice = el('div', 'cp-answer-interrupted');
        notice.setAttribute('role', 'status');
        prose.parentNode.insertBefore(notice, prose.nextSibling);
      }
      notice.textContent = '\u26A0\uFE0F Copilot run incomplete. ' + message;
    }

    function say(message, isError) {
      // A run that failed after it had already put words on screen did not fail to
      // answer: it answered part of the way and then stopped. Replacing that text
      // takes back work the reader has already done, so the failure is stated beneath
      // it instead. The prose stays; the reader is told the run did not finish.
      if (isError && answer.hasProse()) {
        interrupt(message);
        return;
      }
      // The settled answer is the authority on this turn's text, so it is written over
      // the draft and the draft's remainder is dropped rather than drained. A character
      // released after this line would append to the settled answer and corrupt it.
      answer.resetDraft();
      prose.textContent = message;
      if (isError) prose.classList.add('cp-answer-error');
      // No correction to the status row here: every path that reports a failure also
      // finishes the turn, and finishing retires the row. Writing "Not answered" into
      // a detached node would be a line that runs and does nothing.
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
      // place that means "the answer is final", and the turn decides what that reveals.
      onSettled();
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
    function restore(labels) {
      var restored = (labels || []).filter(function (label) {
        return typeof label === 'string' && label.trim();
      });
      if (restored.length && restored[0] !== statusText.textContent) {
        restored.unshift(statusText.textContent);
      }
      stages.length = 0;
      restored.forEach(function (label) { stages.push(label); });
      retire();
    }

    return {
      foot: foot,
      stage: stage,
      finish: finish,
      restore: restore,
      say: say,
      interrupt: interrupt,
    };
  }

  window.CopilotProgress = Object.freeze({ create: create });
})();
