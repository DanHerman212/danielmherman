/* What the draft looks like while it is being written.

   `copilot_draft.js` decides two things and nothing else: which part of the text so far
   is a finished block, and what the unfinished block reads like. Both are string
   operations, so both can be executed here without a browser — which matters, because
   the defect they fix is visual and a browser is the one thing no gate in this
   repository has.

   The rules under test are the two the module exists for. A finished block is markdown
   and is rendered in final form, so it keeps its headings and paragraph breaks. The
   unfinished block is text, because half a `**` and a lone `##` are syntax rather than
   prose, and a citation marker that has not closed is held back rather than shown. */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const DRAFT = readFileSync(join(HERE, '..', '..', 'static', 'js', 'copilot_draft.js'), 'utf8');
const COMPONENTS = readFileSync(
  join(HERE, '..', '..', 'static', 'js', 'a2ui_clinical_components.js'), 'utf8');

// Run in this realm rather than in a `vm` context. The module is pure and hangs itself
// on `window`, so nothing is gained by a separate realm — and a separate realm would hand
// back arrays and objects whose prototypes are not this realm's, which `deepEqual` treats
// as different values that happen to look alike.
globalThis.window = globalThis.window || {};
vm.runInThisContext(DRAFT, { filename: 'copilot_draft.js' });
const CopilotDraft = globalThis.window.CopilotDraft;

const raw = (...pieces) => pieces.join('');

test('a block is finished when the text after it has begun', () => {
  const parts = CopilotDraft.partition(
    '## Hospital course\n\nThe patient was admitted.\n\nShe improved');

  assert.deepEqual(parts.blocks, ['## Hospital course', 'The patient was admitted.']);
  assert.equal(parts.tail, 'She improved');
});

test('the blocks only ever grow: a finished block stays finished', () => {
  const text = '## A\n\nfirst\n\n## B\n\nsecond\n\nthird';
  let previous = [];

  for (let index = 1; index <= text.length; index += 1) {
    const parts = CopilotDraft.partition(text.slice(0, index));
    // Every block the reader has already seen rendered is still there, at the same
    // index. This is what lets the page render each block exactly once.
    assert.deepEqual(parts.blocks.slice(0, previous.length), previous);
    previous = parts.blocks;
  }

  assert.deepEqual(previous, ['## A', 'first', '## B', 'second']);
});

test('a block keeps its markdown, so the renderer can put it in final form', () => {
  const parts = CopilotDraft.partition('**Bold lead.** The rest.\n\nnext');

  assert.deepEqual(parts.blocks, ['**Bold lead.** The rest.']);
  assert.equal(parts.blocks[0].includes('**'), true,
               'the emphasis was stripped before the renderer could read it');
});

test('the unfinished block shows words and never syntax', () => {
  const pieces = CopilotDraft.segments('## Diagnosis and **the plan** so far');

  const shown = pieces.map((piece) => piece.text ?? '').join('');
  assert.equal(shown, 'Diagnosis and the plan so far');
});

test('a citation marker in the unfinished block is a segment of its own', () => {
  const pieces = CopilotDraft.segments('Admitted on the 3rd^[2] and treated');

  assert.deepEqual(pieces, [
    { text: 'Admitted on the 3rd' },
    { cite: '2' },
    { text: ' and treated' },
  ]);
});

test('a marker that has not closed is held back, not shown half-written', () => {
  for (const fragment of ['^', '^[', '^[1', '^[PMID: 3518']) {
    const pieces = CopilotDraft.segments(`Treated with warfarin${fragment}`);
    const shown = pieces.map((piece) => piece.text ?? piece.cite).join('');

    assert.equal(shown, 'Treated with warfarin',
                 `${JSON.stringify(fragment)} reached the reader`);
    assert.equal(pieces.some((piece) => piece.cite !== undefined), false);
  }
});

test('a marker split across two frames resolves when its bracket arrives', () => {
  const first = CopilotDraft.segments('Admitted^[1');
  assert.equal(first.some((piece) => piece.cite !== undefined), false);

  const second = CopilotDraft.segments('Admitted^[12]');
  assert.deepEqual(second, [{ text: 'Admitted' }, { cite: '12' }]);
});

test('a PMID written as the marker is recognised, because the model writes it', () => {
  const pieces = CopilotDraft.segments('Trial^[PMID: 35186616]');

  assert.deepEqual(pieces, [{ text: 'Trial' }, { cite: '35186616' }]);
});

test('a hash in the middle of a sentence is not a heading', () => {
  const pieces = CopilotDraft.segments('See record #1 discharge note');

  assert.equal(pieces.map((piece) => piece.text ?? '').join(''),
               'See record #1 discharge note');
});

test('a marker is set flush against the punctuation that ends its clause', () => {
  // The draft becomes a pill on screen, and the settled answer sets its pill against the
  // full stop. A gap that survived here and closed at the handover would move the
  // sentence under the reader at the moment they finished reading it.
  const pieces = CopilotDraft.segments('Discontinued ^[1] . Next sentence.');

  assert.deepEqual(pieces, [
    { text: 'Discontinued ' },
    { cite: '1' },
    { text: '. Next sentence.' },
  ]);
});

test('a word gap after a marker is still a word gap', () => {
  const pieces = CopilotDraft.segments('Admitted^[1] and treated');

  assert.deepEqual(pieces, [
    { text: 'Admitted' },
    { cite: '1' },
    { text: ' and treated' },
  ]);
});

test('nothing the unfinished block shows ever contains markdown syntax', () => {
  const messy = raw('## Heading\n', '**bold** and *italic*\n', 'a^[3] b^[PMID: 9] c^[',
                    ' | 1 | 2 |\n', '---');

  for (const piece of CopilotDraft.segments(messy)) {
    if (piece.cite !== undefined) continue;
    assert.equal(piece.text.includes('*'), false, piece.text);
    assert.equal(piece.text.includes('^['), false, piece.text);
    assert.equal(/^[ \t]*#{1,6}[ \t]/.test(piece.text), false, piece.text);
  }
});

test('the page and the bundle read one marker pattern, not two', () => {
  // The component lives in the bundle and this runs beside the page: two build targets,
  // so the pattern is duplicated rather than imported. This is what keeps the duplicate
  // honest — the day one of them learns a form the other does not, the draft and the
  // settled answer stop agreeing about which characters are a citation.
  const found = /const MARKER = \/(.+?)\/[gimsuy]*;/.exec(COMPONENTS);
  assert.ok(found, 'the component no longer declares a MARKER');

  assert.equal(new RegExp(CopilotDraft.marker, 'i').source,
               new RegExp(found[1], 'i').source);
});
