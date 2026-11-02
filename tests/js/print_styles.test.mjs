/* Printing a turn (UX gap 1, 2026-11-02).

   Printed to PDF, `/demo/a2ui/` came out as one page with the answer clipped at the
   viewport's edge, the sidebar down its side and the composer across the bottom. The
   cause is not a bug in the shell: `.cp-app` is `100dvh` with `overflow: hidden` and
   `.cp-feed` is the only thing that scrolls, which is right on screen and loses content on
   paper.

   These read the sources rather than a rendered page, because the failure is a rule that
   is ABSENT and no runtime assertion can see an absence. Each assertion names the rule
   that has to survive, not its exact text: the sheet is prose and it will be re-wrapped. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(HERE, '..', '..', ...parts), 'utf8');

const SHELL = read('static', 'css', 'demo_shell.css');
const SHARED = read('static', 'js', 'a2ui', 'shared.js');
const NARRATIVE = read('static', 'js', 'a2ui', 'cited_narrative.js');
const MATRIX = read('static', 'js', 'a2ui', 'comparative_risk_matrix.js');

/** The text of a sheet with its comments removed, so prose cannot satisfy a rule. */
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of the `@media print` block, brace-matched, or ''. */
function printBlock(source) {
  const text = stripComments(source);
  const start = text.indexOf('@media print');
  if (start < 0) return '';
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    else if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return text.slice(start);
}

test('the shell has a print block at all', () => {
  assert.ok(printBlock(SHELL), 'demo_shell.css carries no @media print rule');
  // The page margins are stated outside the block, because `@page` is not a selector.
  assert.match(stripComments(SHELL), /@page\s*\{[^}]*margin:/,
               'no page margins were declared');
});

test('the chrome is removed from the paper', () => {
  const block = printBlock(SHELL);

  for (const selector of ['.cp-side', '.cp-ask', '.cp-context', '.cp-status',
    '.cp-turn-actions', '#cp-side-toggle']) {
    assert.ok(block.includes(selector), selector + ' would print');
  }
  assert.match(block, /display:\s*none\s*!important/);
});

test('every viewport clamp is released, so the browser can paginate', () => {
  const block = printBlock(SHELL);

  // The chain from the page down to the answer is what holds the content back. A single
  // element left with a height or an overflow clamp keeps the whole turn on page one.
  for (const selector of ['html', 'body', '.cp', '.cp-app', '.cp-app-main', '.cp-feed',
    '.cp-answer']) {
    assert.ok(block.includes(selector), selector + ' is not reset for print');
  }
  assert.match(block, /height:\s*auto\s*!important/);
  assert.match(block, /max-height:\s*none\s*!important/);
  assert.match(block, /overflow:\s*visible\s*!important/);
  assert.match(block, /position:\s*static\s*!important/);
  // The shell is a row on screen. On paper the sidebar is gone and the surface is the page.
  assert.match(block, /flex-direction:\s*column\s*!important/);
});

test('the references are a bibliography on paper, not a closed drawer', () => {
  const block = printBlock(SHELL);

  assert.ok(block.includes('.cp-references'), 'the references are not addressed');
  // `<details>` prints in whatever state the reader left it; the summary is a control.
  assert.match(block, /\.cp-references\s*>\s*summary\s*\{\s*display:\s*none\s*!important/);
  // A note passage is clamped to two lines on screen and prints whole.
  assert.match(block, /line-clamp:\s*unset\s*!important/);
});

test('a card is not split across a page break', () => {
  const block = printBlock(SHELL);

  assert.match(block, /break-inside:\s*avoid/);
  assert.match(block, /page-break-inside:\s*avoid/);
  for (const selector of ['.cp-reference-item', '.cp-follow-up']) {
    assert.ok(block.includes(selector), selector + ' may be split by a page break');
  }
});

test('the composed blocks carry their own print rules, in their own shadow roots', () => {
  // A rule in demo_shell.css cannot reach into a shadow root, which is why the components
  // state these themselves. The settle animation in particular must stop: an element
  // caught mid-fade prints at partial opacity.
  const block = printBlock(SHARED);

  assert.ok(block, 'the shared block stylesheet has no print rule');
  assert.match(block, /animation:\s*none/);
  assert.match(block, /break-inside:\s*avoid/);
});

test('the prose column and the cohort table print as a page, not a viewport', () => {
  assert.match(printBlock(NARRATIVE), /max-width:\s*none/,
               'the 68ch screen measure is still applied to paper');
  assert.match(printBlock(MATRIX), /overflow:\s*visible/,
               'the table would print with its last column clipped');
  assert.match(printBlock(MATRIX), /tr,[\s\S]*break-inside:\s*avoid/,
               'a table row may be split by a page break');
});
