/* Enterprise Clinical Copilot — what a half-written answer looks like.

   The draft that fills the canvas while the model is still writing used to be filtered
   by a function called `drawn` inside `copilot_canvas.js`: strip the asterisks, strip
   the citation markers, strip the heading hashes, draw the rest as one string. That
   made the draft and the settled answer two different documents. The words were the
   same and nothing else was — no paragraphs, because a text node collapses `\n\n` to a
   space; no headings, because the hashes had just been removed; and citation markers
   gone entirely, so the one thing a clinical reader scans for vanished while the answer
   was being written and reappeared when it stopped.

   This module answers one question and nothing else: given the text received so far,
   which part of it is a finished block, and what does the unfinished part look like?
   It returns strings and segments, never nodes, so it can be read — and tested — without
   a browser.

   Two rules, and they are the whole design:

   1. A block is finished when the text after it has begun, which is what `\n\n` means.
      Until then its markup is still arriving: `##` may yet become `## Diagnosis`, and a
      `**` may yet close. So a finished block goes to the renderer as MARKDOWN, in its
      final form, and never passes through the filter below.
   2. The unfinished block is drawn as text with its markup removed, because half a
      `**` pair and a lone `##` are syntax rather than prose. A citation marker that has
      not closed is held back rather than shown — `^[1` is not a citation until its
      bracket arrives, and drawing it would put raw syntax in front of the reader only
      to delete it on the next tick. */

(function () {
  'use strict';

  /* The instructed marker form is `^[2]`; `^[PMID: 35186616]` is the form the model
     reaches for anyway on a literature turn. Both name a record. Kept in step with
     `CitedNarrativeElement`'s own by hand rather than shared, because that one runs in
     the bundle and this one runs beside the page: two build targets, one pattern, and
     a test that asserts they have not drifted. */
  var MARKER = '\\^\\[\\s*(?:PMID\\s*[:#]?\\s*)?(\\d+)\\s*\\]';

  function markerPattern() {
    return new RegExp(MARKER, 'gi');
  }

  /* A marker whose closing bracket has not arrived yet, at the very end of the text. */
  var OPEN_MARKER = /\^(\[[^\]]*)?$/;

  /* The text so far, cut into the blocks that are finished and the one that is not.

     `blocks` is raw markdown and grows by appending: the text only ever extends, so a
     block that was finished stays finished and stays at the same index. The caller uses
     that to render each block exactly once. */
  function partition(raw) {
    var text = raw === undefined || raw === null ? '' : String(raw);
    var boundary = text.lastIndexOf('\n\n');
    if (boundary === -1) return { blocks: [], tail: text };

    var head = text.slice(0, boundary);
    var blocks = head.split(/\n{2,}/).filter(function (block) {
      return block.trim().length > 0;
    });
    return { blocks: blocks, tail: text.slice(boundary + 2) };
  }

  /* The unfinished block, as the pieces a caller can put on screen.

     Each entry is either `{text}` or `{cite}`; a marker is a segment of its own so the
     page can draw it as a pill rather than as three characters of syntax. Nothing here
     escapes or sanitises, because nothing here is HTML — the caller builds text nodes. */
  function segments(raw) {
    var text = raw === undefined || raw === null ? '' : String(raw);

    var open = OPEN_MARKER.exec(text);
    if (open) text = text.slice(0, open.index);

    // A heading that has not been committed yet is still a heading: the hashes are
    // syntax, so they go and the words stay. Anchored to a line start and requiring a
    // space after them, so `#1 discharge note` in the body of a sentence is untouched.
    text = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');

    var pieces = [];
    var pattern = markerPattern();
    var cursor = 0;
    var match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > cursor) pieces.push({ text: text.slice(cursor, match.index) });
      pieces.push({ cite: match[1] });
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) pieces.push({ text: text.slice(cursor) });

    // Emphasis is markup too. Removed from the text pieces only — a marker's own
    // digits are never emphasis and are never touched.
    return pieces.map(function (piece) {
      if (piece.cite !== undefined) return piece;
      return { text: piece.text.replace(/\*/g, '') };
    }).filter(function (piece) {
      return piece.cite !== undefined || piece.text.length > 0;
    });
  }

  window.CopilotDraft = Object.freeze({
    marker: MARKER,
    partition: partition,
    segments: segments,
  });
}());
