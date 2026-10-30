/* Enterprise Clinical Copilot — the answer as it is written, and the handover to the surface.

   Three things live here because they are one continuous act: the draft a clinician
   watches arrive, the settled answer that replaces it, and the A2UI surface that is laid
   over the top of it. Splitting any of the three from the others is how the old code came
   to wipe a draft before its replacement existed.

   The cadence itself is `copilot_reveal.js` and the segmentation is `copilot_draft.js`;
   this is the half that draws. Both are read by name, never redefined here — a second
   copy of either would be a second answer to what a marker is.

   Split out of `copilot_canvas.js` in Phase 5. */
(function () {
  'use strict';

  /* How long the settled surface and the draft cross-fade over. Short enough to read as
     one state becoming another rather than as an animation, and matched to
     `.cp-answer.is-settling` in the stylesheet. */
  var SETTLE_MS = 180;

  var renderer = null;          // resolved on the first answer, then reused
  var rendererPromise = null;   // one import, however many turns ask for it
  var rendererFor = '';         // the url that promise was started for

  /* Reduced motion skips the pacing rather than shortening it — the request is for no
     animated text, not for faster animated text. Read on each use rather than once,
     because the setting can change while the page is open. */
  var reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  /* One painted frame later. Two of these is the shortest reliable "the browser has
     laid this out" available to a page that does not control its own stylesheet. */
  function nextFrame() {
    return new Promise(function (resolve) {
      if (window.requestAnimationFrame) {
        window.requestAnimationFrame(function () { resolve(); });
        return;
      }
      window.setTimeout(resolve, 16);
    });
  }

  function wait(ms) {
    return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
  }

  // --- the A2UI renderer --------------------------------------------------------

  async function scene(url) {
    if (!rendererPromise || rendererFor !== url) {
      if (!url) throw new Error('no renderer url');
      rendererFor = url;
      rendererPromise = import(url).then(function (module) {
        renderer = {
          module: module,
          MessageProcessor: module.MessageProcessor,
          // The clinical catalog, from the clinical bundle: it carries the Phase 2
          // components (RiskInfluencers, LiteratureList) that the agent's composer
          // now emits. The legacy risk catalog is not loaded at all, so a surface
          // naming a retired component would draw nothing rather than draw the old
          // widget — a mismatch that fails loudly in review instead of quietly in
          // production.
          catalog: module.buildClinicalCatalog(module.basicCatalog),
        };
        return renderer;
      });
    }
    return rendererPromise;
  }

  /* The markdown provider the surface reads, wrapped to space its paragraphs.

     The surface renders inside nested shadow trees, so no rule in `demo_shell.css` can
     reach the paragraphs it produces — and the element it emits carries no margin of
     its own, which is why consecutive sections rendered flush against each other. The
     spacing therefore has to travel with the HTML: an inline style is the one thing a
     shadow boundary does not filter.

     Applied after the renderer's own sanitizer has run, and to a literal this file owns
     — nothing that came from the model or the user passes through this substitution. */
  function proseMarkdown(url, value) {
    return renderer.module.renderMarkdown(value).then(function (html) {
      return String(html).replace(/<p>/g, '<p style="margin:0 0 0.75rem">');
    });
  }

  /* Mount one envelope into a turn's canvas host.

     The markdown provider sits on the host: the basic Text component renders
     Markdown, and without a provider above it the prose arrives as raw text. One
     provider per turn, so no turn depends on another having been mounted first.

     A fresh processor per turn: reusing one would carry the previous surface into the
     new one and draw both. */
  async function mount(host, envelope, url) {
    var loaded = await scene(url);
    new loaded.module.ContextProvider(host, {
      context: loaded.module.Context.markdown,
      initialValue: function (value) { return proseMarkdown(url, value); },
    });
    var processor = new loaded.MessageProcessor([loaded.catalog]);
    var created = null;
    processor.onSurfaceCreated(function (surface) {
      var element = document.createElement('a2ui-surface');
      element.surface = surface;
      // Invisible until the draft has been handed over, and laid out anyway: the two
      // are cross-faded in one grid cell, so the surface's height has to count before
      // it can be seen. `settle` removes this class.
      element.classList.add('cp-entering');
      host.appendChild(element);
      created = element;
    });
    processor.processMessages(envelope.messages);
    return created;
  }

  /* One turn's prose: the draft, the settled answer, and the cross-fade between them. */
  function create(options) {
    var el = options.el;
    var url = options.rendererUrl;
    var root = options.root;
    var prose = options.prose;
    var answerSection = options.answerSection;
    var onReconciled = options.onReconciled;

    var streamed = '';   // every character released, for the block renderer
    var committed = 0;   // how many blocks have been rendered, so each is rendered once
    var tail = null;     // the element holding the unfinished block

    /* Which composed narrative this turn is drawing, once it exists.

       The prose and its markers live inside two shadow trees — the A2UI surface's and
       the narrative's own — so this page cannot select into them and must not try. The
       component announces itself with a composed event when it first updates; that
       event crosses upward out of both boundaries and is the only thing this side
       learns about the renderer's internals. See `CitedNarrativeElement`'s
       `a2ui-cited-narrative-ready`.

       Null for a turn with no canvas: an answer that is prose only, a refusal, a
       failed request. Every caller tolerates it, because a drawer row exists on turns
       whose canvas drew nothing. */
    var narrative = null;
    root.addEventListener('a2ui-cited-narrative-ready', function (event) {
      narrative = (event.detail && event.detail.element) || null;
    });

    /* Show which sentence the passage just opened belongs to.

       The component does the showing — it owns the marker, the stylesheet and the
       1,400 ms — and returns false when there is nothing to reveal: a prose-only turn,
       or markers still inert because the answer is streaming. */
    function revealMarker(index) {
      if (!narrative) return;
      narrative.revealCitation(index);
    }

    var reveal = window.CopilotReveal.create(function (slice) {
      streamed += slice;
      renderDraft();
    }, { reducedMotion: reduceMotion.matches });

    function renderDraft() {
      var parts = window.CopilotDraft.partition(streamed);
      for (var index = committed; index < parts.blocks.length; index += 1) {
        renderBlock(parts.blocks[index]);
      }
      committed = parts.blocks.length;
      renderTail(parts.tail);
    }

    /* One finished block, in its final form.

       Appended empty and filled when the provider resolves, so what the reader sees is
       in the order the blocks arrived even though rendering is asynchronous: every block
       of a turn awaits the same promise, and its callbacks run in the order they were
       registered. */
    function renderBlock(markdown) {
      var host = el('div', 'cp-draft-block');
      host.setAttribute('aria-busy', 'true');
      prose.insertBefore(host, tail);
      scene(url).then(function () { return proseMarkdown(url, markdown); }).then(function (html) {
        host.innerHTML = html;
        host.removeAttribute('aria-busy');
        decorateInert(host);
      }, function () {
        // No renderer yet, or it refused. The block is still true; it arrives as words
        // rather than as markup, and the settled answer replaces it a moment later.
        host.textContent = plain(markdown);
        host.removeAttribute('aria-busy');
      });
    }

    /* A block as words, for the fallback above and for nothing else. */
    function plain(markdown) {
      return window.CopilotDraft.segments(markdown).map(function (piece) {
        return piece.cite === undefined ? piece.text : piece.cite;
      }).join('');
    }

    /* The block that has not finished arriving.

       Its markup is still on the way — `##` may yet become `## Diagnosis`, a `**` may yet
       close — so it is drawn as text with the syntax removed, which is what
       `CopilotDraft.segments` decides. It is one element, replaced in place, so the
       reader watches a sentence finish rather than a node appear. */
    function renderTail(text) {
      if (!tail) {
        tail = el('span', 'cp-draft-tail');
        prose.appendChild(tail);
      }
      tail.textContent = '';
      window.CopilotDraft.segments(text).forEach(function (piece) {
        tail.appendChild(piece.cite === undefined
          ? document.createTextNode(piece.text)
          : markerPill(piece.cite));
      });
    }

    /* A citation marker during the draft. Not a control: there is nothing to open until
       the answer settles, and a button that opens nothing is worse than a marker that
       plainly is not one. */
    function markerPill(label) {
      var pill = el('span', 'cp-cite');
      pill.setAttribute('aria-hidden', 'true');
      pill.textContent = label;
      return pill;
    }

    /* Citation markers inside a finished block, as inert pills.

       The substitution the component makes once the answer settles, minus the
       interaction. Done on the rendered DOM rather than on the markdown source, because a
       marker sits mid-sentence: splitting the source would hand the renderer two
       half-paragraphs and it would close each of them. */
    function decorateInert(host) {
      var pattern = new RegExp(window.CopilotDraft.marker, 'gi');
      var walker = document.createTreeWalker(host, window.NodeFilter.SHOW_TEXT);
      var targets = [];
      while (walker.nextNode()) {
        if (walker.currentNode.data.indexOf('^[') !== -1) targets.push(walker.currentNode);
      }
      targets.forEach(function (node) {
        var found = [];
        var match;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(node.data)) !== null) found.push(match);
        if (!found.length) return;
        var fragment = document.createDocumentFragment();
        var cursor = 0;
        found.forEach(function (marker) {
          fragment.appendChild(
            document.createTextNode(node.data.slice(cursor, marker.index)));
          fragment.appendChild(markerPill(marker[1]));
          cursor = marker.index + marker[0].length;
        });
        fragment.appendChild(document.createTextNode(node.data.slice(cursor)));
        node.parentNode.replaceChild(fragment, node);
      });
    }

    /* Take the draft away without ending the turn.

       For the run that went back for evidence: the model spoke, was sent to a tool or
       told to retrieve, and will answer again. The prose on screen belongs to the first
       pass and is not the answer — the answer is the last pass's — so it goes at the
       frame that says the run moved on, rather than being replaced by the settled answer
       a moment later. The reveal stays open: the next pass pours into this same turn,
       and its opening characters must not be painted underneath the tail of the abandoned
       one. */
    function abandonDraft() {
      reveal.discard();
      prose.textContent = '';
      streamed = '';
      committed = 0;
      tail = null;
    }

    /* Take the draft away, and stop the cadence feeding it.

       Called once the surface has crossed over, and by the progress module — the one
       path that replaces the text outright. A character released after either of those
       would append to an answer that is no longer the draft. */
    function resetDraft() {
      reveal.cancel();
      prose.textContent = '';
      streamed = '';
      committed = 0;
      tail = null;
    }

    function appendProse(piece) {
      reveal.push(piece);
    }

    /* Whether this turn holds any prose at all, drawn or still queued. The caller needs
       the difference: a turn whose stream ended without an answer frame is a failure,
       but a turn with characters still waiting to be drawn is a draft, and treating it
       as a failure would replace a partial answer with an apology. */
    function hasProse() {
      return reveal.released > 0 || reveal.pending > 0;
    }

    /* Finish the pour, and resolve when the last character is on screen.

       Awaiting this before anything replaces the draft is the whole of the first defect:
       the settled answer used to overwrite a queue that was still a third full, so the
       reader was shown the beginning of a draft and then the whole answer. A turn read
       back from the store has nothing queued and this resolves without doing anything. */
    function flushProse() {
      return reveal.flush();
    }

    /* Lay the settled surface over the draft, and take the draft away.

       The two ways this goes wrong are both visible. Two copies of the answer stacked
       vertically, because both elements are in normal flow and both have height; or the
       answer briefly blank, because the draft was removed before the surface was drawn. So
       during the handover `.cp-answer` stacks its children in ONE grid cell — the draft
       underneath, the surface over it at opacity 0 — and the two cross-fade in place. When
       the fade ends the draft is emptied and the cell collapses back into normal flow, at
       a moment when nothing on screen is changing.

       The two frames before the fade are not ceremony. The surface has to be laid out
       before its opacity can animate against a cell of the right height, and a transition
       started in the same task as the append would start from a height that is still
       being computed. */
    function settle(surface) {
      if (!surface) {
        resetDraft();
        return Promise.resolve();
      }
      answerSection.classList.add('is-settling');
      return nextFrame()
        .then(nextFrame)
        .then(function () {
          // The same frame for both, which is the point: the surface begins to appear as
          // the draft begins to leave, never after it has gone.
          surface.classList.remove('cp-entering');
          prose.classList.add('cp-leaving');
          return reduceMotion.matches ? null : wait(SETTLE_MS);
        })
        .then(function () {
          resetDraft();
          prose.classList.remove('cp-leaving');
          answerSection.classList.remove('is-settling');
        });
    }

    /* What the server said about the prose it announced, once it settled. `visible`
       means a guardrail removed something from what the reader has just read. */
    function settleProse(swap) {
      if (swap !== 'visible') return;
      onReconciled();
    }

    /* What has still to be drawn, drawn now — for a run that stopped with characters
       queued behind the failure. */
    function drainNow() {
      if (reveal.pending) reveal.drainNow();
    }

    function cancelReveal() {
      reveal.cancel();
    }

    return {
      prose: prose,
      appendProse: appendProse,
      hasProse: hasProse,
      flushProse: flushProse,
      abandonDraft: abandonDraft,
      resetDraft: resetDraft,
      settle: settle,
      settleProse: settleProse,
      revealMarker: revealMarker,
      drainNow: drainNow,
      cancelReveal: cancelReveal,
    };
  }

  window.CopilotAnswer = Object.freeze({ create: create, mount: mount });
})();
