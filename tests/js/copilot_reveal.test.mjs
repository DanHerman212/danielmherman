/* The reveal state machine, executed rather than read.

   `copilot_reveal.js` is loaded into a `vm` context with only a `window` object to hang
   itself on, and driven by a clock this file owns. That is the whole point of the
   extraction: the defect being fixed was a cadence that could not converge, and a
   cadence is arithmetic. The two numbers that matter are asserted below — the tail is
   poured before anything is allowed to replace it, and a single large frame is not
   painted whole.

   Nothing here touches a DOM, and nothing here needs one. */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, '..', '..', 'static', 'js', 'copilot_reveal.js'),
                            'utf8');

function load() {
  // The host's own `Promise`, handed to the sandbox: a promise minted inside a `vm`
  // realm is a foreign thenable to the test runner, and awaiting one leaves the runner
  // waiting on an event loop it cannot see settle.
  const sandbox = { window: {}, Promise };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'copilot_reveal.js' });
  return sandbox.window.CopilotReveal;
}

/* A clock with timers on it, driven by hand. `advance` runs everything due, in order,
   and then moves the hands — so a test that advances two seconds executes exactly the
   ticks a browser would have executed in two seconds, at the instants it would have
   executed them. */
function clock() {
  let at = 0;
  let due = [];
  let seq = 0;
  return {
    now: () => at,
    schedule(fn, ms) {
      const id = ++seq;
      due.push({ id, at: at + ms, fn });
      return id;
    },
    cancel(id) {
      due = due.filter((timer) => timer.id !== id);
    },
    advance(ms) {
      const target = at + ms;
      for (;;) {
        due.sort((left, right) => left.at - right.at || left.id - right.id);
        const next = due[0];
        if (!next || next.at > target) break;
        due.shift();
        at = next.at;
        next.fn();
      }
      at = target;
    },
    get timers() { return due.length; },
  };
}

/* One turn's worth of traffic: 900 characters in 20-character delta frames, a frame
   every 100 ms. That is 200 characters a second, which is roughly what the model writes,
   and it is four times the cadence's floor — the ratio the old fixed rate could not
   survive. */
function stream(reveal, hands, text) {
  for (let index = 0; index < text.length; index += 20) {
    reveal.push(text.slice(index, index + 20));
    hands.advance(100);
  }
}

function subject(options) {
  const hands = clock();
  const painted = [];
  const reveal = load().create((slice) => painted.push(slice), Object.assign({
    now: hands.now,
    schedule: hands.schedule,
    cancel: hands.cancel,
  }, options));
  return { hands, painted, reveal, text: () => painted.join('') };
}

test('every character pushed is painted, exactly once, in order', async () => {
  const answer = 'abcdefghij'.repeat(90);          // 900 characters
  const turn = subject();

  stream(turn.reveal, turn.hands, answer);

  // The stream has stopped and the turn is not finished: there is still a tail. This
  // is the state the old cadence guaranteed, and the old swap threw the tail away.
  assert.ok(turn.text().length < answer.length, 'the draft finished without being paced');

  const flushed = turn.reveal.flush();
  turn.hands.advance(2000);
  const settled = await flushed;

  assert.equal(turn.text(), answer, 'the last character of the answer never reached the page');
  assert.equal(turn.reveal.pending, 0);
  assert.equal(settled.pending, 0);
  assert.equal(turn.reveal.settledFraction, 1);
});

test('a single frame carrying the whole answer is paced, not pasted', () => {
  // `/meds` announces its narrative as ONE delta: the previous burst-on-first-tick rule
  // painted all of it in the opening frame.
  const turn = subject();
  const answer = 'm'.repeat(400);

  turn.reveal.push(answer);

  assert.ok(turn.text().length > 0, 'nothing was painted at all');
  assert.ok(turn.text().length <= load().pacing.firstPaintCap,
            `the first paint was ${turn.text().length} characters, past the cap`);
  assert.ok(turn.reveal.pending > 0, 'the rest of the answer was dropped at the first paint');

  turn.hands.advance(1000);
  assert.ok(turn.text().length < answer.length, 'the answer was painted in one second');
  assert.equal(answer.startsWith(turn.text()), true, 'the draft is not a prefix of the answer');
});

test('the draft keeps up with the wire instead of falling behind it', () => {
  const turn = subject();
  const answer = 'lorem ipsum dolor sit amet. '.repeat(30);
  let worst = 0;

  for (let index = 0; index < answer.length; index += 20) {
    turn.reveal.push(answer.slice(index, index + 20));
    worst = Math.max(worst, turn.reveal.pending);
    turn.hands.advance(100);
  }

  // The rate is the backlog over `lagMs`, so the backlog cannot run away: it settles
  // where the release rate equals the arrival rate. The old table had no such point —
  // 45 characters a second against 200 meant the queue grew for as long as the model
  // kept writing.
  assert.ok(worst < 400, `the backlog reached ${worst} characters`);
  assert.equal(answer.startsWith(turn.text()), true);
});

test('flush resolves only once the queue is empty', async () => {
  const turn = subject();
  turn.reveal.push('q'.repeat(500));

  let resolvedAt = null;
  const flushed = turn.reveal.flush().then((value) => {
    resolvedAt = turn.reveal.pending;
    return value;
  });

  turn.hands.advance(10);
  assert.equal(resolvedAt, null, 'flush resolved with characters still queued');

  turn.hands.advance(2000);
  await flushed;
  assert.equal(resolvedAt, 0);
  assert.equal(turn.reveal.pending, 0);
});

test('the pour has a deadline: the tail arrives within a fraction of a second', async () => {
  const turn = subject();
  turn.reveal.push('r'.repeat(600));
  turn.hands.advance(100);          // let the opening burst out of the way

  const flushed = turn.reveal.flush();
  turn.hands.advance(load().pacing.flushMs + 200);
  await flushed;

  assert.equal(turn.reveal.pending, 0);
  assert.ok(turn.text().length === 600);
});

test('reduced motion paints at once and schedules nothing', () => {
  const turn = subject({ reducedMotion: true });
  turn.reveal.push('s'.repeat(400));

  assert.equal(turn.text(), 's'.repeat(400));
  assert.equal(turn.reveal.pending, 0);
  assert.equal(turn.hands.timers, 0, 'a timer was scheduled under prefers-reduced-motion');
});

test('cancel stops the pour and paints nothing further', () => {
  const turn = subject();
  turn.reveal.push('t'.repeat(400));
  const drawn = turn.text().length;

  turn.reveal.cancel();
  turn.hands.advance(2000);

  assert.equal(turn.text().length, drawn);
  assert.equal(turn.reveal.pending, 0);
  assert.equal(turn.hands.timers, 0);
});
