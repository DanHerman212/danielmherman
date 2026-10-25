/* Every identifier in the page scripts exists.

   One rule, `no-undef`, over `static/js/copilot_*.js`. It is a test rather than a lint
   step because a lint step nobody runs is a lint step that does not exist, and the
   defect that put it here survived every gate this repository had.

   What it would have caught: on 2026-10-25 `copilot_threads.js` called `el`,
   `createTurn` and `fillTurn`, all of which had stayed inside `copilot_canvas.js`'s
   closure during the Phase 5 split. The file parsed. The Django tests read it as text.
   The boundary test checked only the calls it makes *through* `window.CopilotFeed`, and
   these three were bare. The sidebar threw on its first render and the stored-thread
   restore threw on every open, in production.

   A runtime test cannot close this on its own: it only visits the code paths it knows
   about, and a free identifier in a path nobody calls stays invisible until someone
   calls it. This reads the file instead of running it. */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PATTERN = 'static/js/copilot_*.js';

test('no page script references an identifier it does not have', async () => {
  const eslint = new ESLint({ cwd: ROOT });
  const files = await eslint.lintFiles([PATTERN]);

  // A glob that matches nothing reports nothing, which is the shape of a green test
  // that checks nothing at all.
  assert.ok(files.length >= 6, `the lint matched ${files.length} files`);
  assert.ok(files.some((result) => result.filePath.endsWith('copilot_threads.js')),
            'the thread module was not among the files linted');

  const formatter = await eslint.loadFormatter('stylish');
  const failures = files.filter((result) => result.errorCount > 0);

  assert.deepEqual(
    failures.map((result) => result.filePath.split('/').pop()),
    [],
    await formatter.format(failures));
});
