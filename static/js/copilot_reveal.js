/* Enterprise Clinical Copilot — the cadence the draft is drawn at.

   Characters arrive faster than they can be read, so they are released to the screen
   at a speed a person can follow. That pacing lives at the last stop before the DOM and
   nowhere earlier: a byte held at the agent or at the Django proxy would buy smoothness
   with time to first token, which is the one number worth protecting.

   What this replaces, and why it is a module rather than a closure:

   The cadence used to live inside `createTurn` in `copilot_canvas.js`, as a
   `setInterval` over a `pending` string. Two things were wrong with it and neither
   could be tested. It released 45 characters a second against a model that writes
   two or three hundred, so the queue could only ever grow — an answer longer than
   45 x (stream duration) was guaranteed to be behind when the settled answer landed,
   and the swap then discarded whatever was left. And it read the clock through
   `setInterval` and drew into a `document` node, so nothing could exercise it without
   a browser.

   The cadence here is a proportional controller with a bounded lag: the release rate
   is the backlog divided by `lagMs`, so a long answer drains faster than a short one
   and the draft can never fall more than about `lagMs` behind the wire. The rate has a
   floor, because below reading speed the text stops being readable and starts being a
   stutter, and a ceiling, because past `maxCps` the reader is watching a paste.

   Everything else is injected. `paint` receives the characters; `now`, `schedule` and
   `cancel` are the clock. That is the whole reason the file exists — the state machine
   is the part that was wrong, and it is now the part a test can drive. */

(function () {
  'use strict';

  /* The cadence, in one table.

     `lagMs` is the property worth keeping: it is how far behind the wire the draft is
     allowed to be. `firstPaintCap` is the lookahead exception — the agent holds its
     first chunks back so a tool call is not announced as prose, and holding them a
     second time here would spend on the first paint exactly the latency that hold was
     paid to avoid. It is a cap and not a licence, because `/meds` sends its whole
     narrative as ONE frame: uncapped, that frame would be painted in full in the first
     tick, which is the same "everything at once" the streaming exists to remove. */
  var PACING = {
    minCps: 45,
    maxCps: 900,
    lagMs: 900,
    flushMs: 320,
    tickMs: 16,
    firstPaintCap: 120,
  };

  function clamp(value, low, high) {
    if (value < low) return low;
    if (value > high) return high;
    return value;
  }

  /* One reveal, for one turn.

     `paint` is called with a slice of the text, in order, and is the only thing this
     knows how to do to the world. The slices are raw: this module does not filter
     markup, because whether a fragment may be drawn is a question about rendering
     (`copilot_draft.js` decides what a half-written block looks like) and not about
     timing. Keeping the two apart is what lets the controller be tested for what it is:
     every character pushed is eventually painted, exactly once, in order. */
  function create(paint, options) {
    var opts = options || {};
    var table = opts.pacing || PACING;
    var now = opts.now || function () { return Date.now(); };
    var schedule = opts.schedule || function (fn, ms) { return setTimeout(fn, ms); };
    var unschedule = opts.cancel || function (id) { clearTimeout(id); };
    var reduced = opts.reducedMotion === true;

    var queue = '';      // received, not yet painted
    var released = 0;    // characters handed to paint
    var budget = 0;      // fractional characters carried between ticks
    var timer = null;
    var since = 0;       // when the tick now being measured began
    var firstPaint = true;
    var flushing = false;
    var flushQuota = 0;  // characters per tick during the pour
    var closed = false;
    var waiters = [];

    // How many ticks the pour has. Rounded rather than assumed, so the quota and the
    // deadline describe the same number of frames.
    var FLUSH_STEPS = Math.max(1, Math.round(table.flushMs / table.tickMs));

    function armFlush() {
      flushing = true;
      flushQuota = Math.max(1, Math.ceil(queue.length / FLUSH_STEPS));
    }

    function release() {
      var owed = waiters;
      waiters = [];
      owed.forEach(function (resolve) {
        resolve({ pending: queue.length, released: released });
      });
    }

    function stopTimer() {
      if (timer !== null) {
        unschedule(timer);
        timer = null;
      }
    }

    function wake() {
      if (timer !== null || closed || !queue) return;
      since = now();
      timer = schedule(tick, table.tickMs);
    }

    function tick() {
      timer = null;
      if (closed) return;
      // Measured against the clock rather than assumed to be `tickMs`: a timer is
      // never early and is often late, and a cadence that credits a late tick with
      // nominal time runs slow by exactly the amount it was late.
      var at = now();
      var elapsed = Math.max(0, at - since);
      since = at;

      if (!queue) {
        budget = 0;
        flushing = false;
        release();
        return;
      }

      var rate = clamp(queue.length / (table.lagMs / 1000), table.minCps, table.maxCps);
      var take;
      if (flushing) {
        // A quota rather than a rate. Dividing the backlog by `flushMs` every tick is
        // exponential decay — each tick takes a fraction of what is LEFT — and measured,
        // it left the last few characters to a remainder that rounded down for the better
        // part of a second. The quota is fixed when the pour is armed, so the tail goes
        // out in `flushMs` however much of it there is.
        take = flushQuota;
        budget = 0;
      } else {
        budget += rate * (elapsed / 1000);
        take = Math.floor(budget);
        if (take < 1) {
          wake();
          return;
        }
        budget -= take;
      }
      if (take > queue.length) take = queue.length;
      paint(queue.slice(0, take));
      released += take;
      queue = queue.slice(take);

      if (queue) {
        wake();
      } else {
        budget = 0;
        flushing = false;
        release();
      }
    }

    function push(text) {
      var piece = text === undefined || text === null ? '' : String(text);
      if (closed || !piece) return;

      // No cadence, but not no reveal: the request is for no animated text, so the
      // text arrives in the frame it was received and nothing is scheduled. Read at
      // every call rather than once, because the setting can change while the page is
      // open.
      if (reduced) {
        firstPaint = false;
        paint(piece);
        released += piece.length;
        release();
        return;
      }

      queue += piece;

      if (flushing) {
        // More arrived while the pour was running: the quota is what is left over what
        // is left of the deadline, so the added text does not extend it.
        armFlush();
        wake();
        return;
      }

      if (firstPaint) {
        firstPaint = false;
        var burst = Math.min(queue.length, table.firstPaintCap);
        paint(queue.slice(0, burst));
        released += burst;
        queue = queue.slice(burst);
        budget = 0;
        if (queue) wake(); else release();
        return;
      }

      wake();
    }

    /* Finish the pour, and resolve when it is finished.

       Called before anything replaces the draft. It is a promise rather than a
       duration because the caller's next act — mounting the surface over this text —
       must happen after the last character is on screen, not after a guess at when it
       will be. */
    function flush() {
      if (closed || !queue) {
        return Promise.resolve({ pending: 0, released: released });
      }
      armFlush();
      return new Promise(function (resolve) {
        waiters.push(resolve);
        wake();
      });
    }

    /* Paint everything held, now, and stop.

       For the one caller that cannot wait: a run that stopped midway. What is queued
       arrived before the failure and belongs to the same answer, so it is drawn rather
       than dropped — the notice that follows qualifies the text above it. */
    function drainNow() {
      stopTimer();
      flushing = false;
      if (queue) {
        paint(queue);
        released += queue.length;
        queue = '';
      }
      budget = 0;
      release();
    }

    function close() {
      closed = true;
      stopTimer();
      queue = '';
      budget = 0;
      flushing = false;
      release();
    }

    return Object.freeze({
      push: push,
      flush: flush,
      drainNow: drainNow,
      cancel: close,
      get pending() { return queue.length; },
      get released() { return released; },
      get settledFraction() {
        var total = released + queue.length;
        return total ? released / total : 1;
      },
    });
  }

  window.CopilotReveal = Object.freeze({
    pacing: PACING,
    create: create,
  });
}());
