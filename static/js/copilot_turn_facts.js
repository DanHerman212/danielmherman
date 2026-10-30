/* Enterprise Clinical Copilot — what a turn says about itself besides its answer.

   The scope pill, the routing note, the verified badge, the references drawer and the
   next questions. They are one module because they are one kind of statement: facts
   about the turn, drawn around the answer rather than in it.

   Every field is defaulted, because a thread spans the change that introduced them: a
   turn stored before 4A-2 replays with none of the three, and it has to draw as an
   ordinary turn rather than as a broken one. `scope: null` in particular is a real
   value — a redirect rested on nothing — so it shows no pill rather than a guess.

   Split out of `copilot_canvas.js` in Phase 5. The page hands in the elements it built
   and the two things this module cannot know: how to ask a follow-up question, and how
   to highlight the sentence a citation belongs to. */
(function () {
  'use strict';

  function create(options) {
    var el = options.el;
    var scopeEl = options.scopeEl;
    var routedEl = options.routedEl;
    var evidenceEl = options.evidenceEl;
    var references = options.references;
    var followUps = options.followUps;
    var askFollowUp = options.askFollowUp;
    var revealMarker = options.revealMarker;
    var centreIntoView = options.centreIntoView;

    var referenceMarkerTimer = null;

    /* That the answer was checked against — and grounded in — the patient record.

       One pill in the header, drawn for every turn the envelope marks `verified`, live
       or read back from the store. The title carries what was checked, because the
       sentence on the pill says the reassuring half and the reader is owed the specific
       one on hover. */
    function showVerified() {
      evidenceEl.textContent = '\u{1F6E1}\u{FE0F} Verified against the chart';
      evidenceEl.title =
        'This answer was checked against the patient record and rests on it: retrieved '
          + 'note text, a structured chart result, or the admission summary.';
      evidenceEl.hidden = false;
    }

    /* A guardrail removed something from what the reader has just read.

       The wording is deliberately quiet and the detail is on the title. The previous
       text stated outright that part of the answer had been removed; that is the fact,
       but a full-width amber box stating it read as a hazard alarm for what is a routine
       reconciliation against the record. What has NOT changed is that the reader is
       told: the pill appears for this case and no other, and says on hover exactly what
       happened.

       It says this whether or not the turn was also verified: the correction is the more
       specific fact, and two pills in one slot would be one fact hidden behind the
       other. */
    function reconciled() {
      evidenceEl.textContent = '\u{1F6E1}\u{FE0F} Reconciled with medical record';
      evidenceEl.title =
        'Part of what was shown while this answer was being written was removed after it '
          + 'was checked against the record. The answer below is the verified version.';
      evidenceEl.hidden = false;
    }

    /* The card's "See all references" — a request to be taken to the whole list.

       The card lives inside two shadow trees this page does not own and the list lives
       out here, so the card announces the intent with a composed event and the turn
       answers it. The event carries the index of the citation it was opened from, and
       that is the row to land on: a reader who asked about `5 · The Journal of
       Arthroplasty` wants row 5, not the top of a drawer holding five rows.

       The row is marked for a moment afterwards, because a smooth scroll ends somewhere
       and the reader has to be able to tell which of the rows it ended at. */
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
      window.clearTimeout(referenceMarkerTimer);
      referenceMarkerTimer = window.setTimeout(function () {
        target.classList.remove('is-target');
      }, 1600);
      // The caret travels with the view, so a keyboard reader arrives where the scroll
      // took them. The row's own control is focused rather than the drawer: the drawer's
      // summary would put them back above the row they just asked for.
      var control = target.querySelector('.cp-reference-head');
      if (control) control.focus({ preventScroll: true });
      return true;
    }

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
        chevron.textContent = '\u203A';
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
      return buttons;
    }

    /* The chrome a turn carries besides its answer: what the answer rested on, the
       records its markers resolve to, and the next questions.

       Every field is defaulted, because a thread spans the change that introduced them:
       a turn stored before 4A-2 replays with none of the three, and it has to draw as an
       ordinary turn rather than as a broken one. `scope: null` in particular is a real
       value — a redirect rested on nothing — so it shows no pill rather than a guess. */
    function present(payload) {
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
        routedEl.textContent = '\u26A1 Routed to /' + payload.routed_to;
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
      /* Every turn that has references lists them, whatever it answered from.

         This was gated on `scope === 'patient_chart'`, on the reasoning that a chart turn
         was the only turn whose evidence had no surface of its own — a literature turn
         illustrated its own sources, so listing them again was the same evidence twice.

         That reasoning stopped holding when a literature turn's records became citations
         (Phase F, 2026-10-26): the canvas no longer draws them, so on `/pubmed` this gate
         was suppressing the only place the papers could be read. Reported live as three
         numbered pills and no `REFERENCES` drawer at all.

         The rule is now structural rather than domain-shaped: if the turn published
         references, the turn shows them. Nothing here should have to know what a scope
         means. */
      presentReferences(payload.references || []);
      presentFollowUps(payload.follow_ups || []);
    }

    return {
      present: present,
      reconciled: reconciled,
      showReference: showReference,
    };
  }

  window.CopilotTurnFacts = Object.freeze({ create: create });
})();
