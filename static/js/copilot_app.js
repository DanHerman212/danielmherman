/* Enterprise Clinical Copilot — the application shell's behaviour.

   One control, two behaviours. Above 700px the menu collapses to an icon rail and
   the preference is remembered across reloads. Below 700px there is no rail to
   collapse to — 64px of icons beside a working composer does not fit either — so
   the same button slides the menu in as a temporary overlay drawer instead.
   Nothing is remembered in that mode: a drawer is dismissed by using it, not by
   preference.

   The account menu at the top right, and the ask bar this page shares with the
   front door, are driven by copilot_shell.js, which is loaded alongside this file. */
(function () {
  'use strict';

  var app = document.getElementById('copilot-shell');
  var sideToggle = document.getElementById('cp-side-toggle');
  var scrim = document.getElementById('cp-scrim');
  var threadList = document.getElementById('cp-thread-list');
  var PREFERENCE_KEY = 'ecc.menu.collapsed';

  // The one breakpoint the drawer exists below. Read here rather than duplicated
  // from the stylesheet because the behaviour changes across it, not just the
  // layout: the same click means "collapse" on one side and "open" on the other.
  var NARROW = window.matchMedia('(max-width: 700px)');

  // Best-effort: private browsing and some embedded webviews throw on
  // localStorage rather than returning null, and a preference is not worth a
  // broken page.
  function remember(collapsed) {
    try {
      window.localStorage.setItem(PREFERENCE_KEY, collapsed ? '1' : '0');
    } catch (error) {
      /* not persisted; the menu still collapses for this page */
    }
  }

  function recalled() {
    try {
      return window.localStorage.getItem(PREFERENCE_KEY) === '1';
    } catch (error) {
      return false;
    }
  }

  function narrow() {
    return NARROW.matches;
  }

  function collapsedNow() {
    return !!app && app.classList.contains('is-collapsed');
  }

  function drawerOpen() {
    return !!app && app.classList.contains('is-drawer-open');
  }

  /* The accessible name follows what the control will do, and that is not the same
     thing at both widths: "collapse" describes a column and "open" describes a
     drawer. A reader who cannot see the layout has only this to go on.

     Neither name says "menu". The account button at the top right is announced as
     "Open menu", and two controls one word apart, each offering a menu, is a
     distinction a reader cannot act on. This one navigates; that one is an account. */
  function describe(open) {
    var label;
    if (narrow()) {
      label = open ? 'Close navigation' : 'Open navigation';
    } else {
      label = open ? 'Collapse navigation' : 'Expand navigation';
    }
    sideToggle.setAttribute('aria-label', label);
    sideToggle.title = label;
  }

  function syncAria() {
    var open = narrow() ? drawerOpen() : !collapsedNow();
    sideToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    describe(open);
  }

  function setCollapsed(collapsed) {
    if (!app || !sideToggle) return;
    // No rail exists below the breakpoint, so a remembered collapse is not applied
    // there. The drawer is the whole of the narrow layout, and leaving the class on
    // would size the drawer to 64px.
    app.classList.toggle('is-collapsed', narrow() ? false : !!collapsed);
    syncAria();
  }

  function setDrawer(open) {
    if (!app || !sideToggle) return;
    app.classList.toggle('is-drawer-open', !!open && narrow());
    syncAria();
  }

  if (app && sideToggle) {
    setCollapsed(recalled());

    sideToggle.addEventListener('click', function () {
      if (narrow()) {
        setDrawer(!drawerOpen());
        return;
      }
      var collapsed = !collapsedNow();
      setCollapsed(collapsed);
      remember(collapsed);
    });

    // The drawer is temporary, so everything that means "I am done with the menu"
    // closes it: the scrim, Escape, and choosing a thread. Leaving it open over the
    // conversation the reader just asked for is the failure a drawer is meant to
    // avoid, not a state to linger in.
    if (scrim) {
      scrim.addEventListener('click', function () {
        setDrawer(false);
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && drawerOpen()) setDrawer(false);
    });

    if (threadList) {
      threadList.addEventListener('click', function () {
        setDrawer(false);
      });
    }

    // Crossing the breakpoint leaves neither state behind: the drawer is dismissed,
    // and the rail reverts to the preference the reader last expressed at a width
    // where a rail exists.
    function onBreakpoint() {
      setDrawer(false);
      setCollapsed(recalled());
    }

    if (NARROW.addEventListener) {
      NARROW.addEventListener('change', onBreakpoint);
    } else if (NARROW.addListener) {
      // Safari before 14. Kept because a drawer that survives a resize is a bug
      // that only shows up on one browser. TODO: remove when Safari 13 is out of
      // support at this project's discretion.
      NARROW.addListener(onBreakpoint);
    }
  }
})();
