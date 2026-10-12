/* Enterprise Clinical Copilot — the application shell's behaviour.

   One control: the menu collapses to an icon rail, and the preference is
   remembered across reloads. The account menu at the top right, and the ask bar
   this page shares with the front door, are driven by copilot_shell.js, which is
   loaded alongside this file. */
(function () {
  'use strict';

  var app = document.getElementById('copilot-shell');
  var sideToggle = document.getElementById('cp-side-toggle');
  var PREFERENCE_KEY = 'ecc.menu.collapsed';

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

  function setCollapsed(collapsed) {
    if (!app || !sideToggle) return;
    app.classList.toggle('is-collapsed', collapsed);
    // aria-expanded describes the menu, so a collapsed menu is not expanded.
    sideToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  if (app && sideToggle) {
    setCollapsed(recalled());

    sideToggle.addEventListener('click', function () {
      var collapsed = !app.classList.contains('is-collapsed');
      setCollapsed(collapsed);
      remember(collapsed);
    });
  }
})();
