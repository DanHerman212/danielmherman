/* Enterprise Clinical Copilot — shell behaviour shared by the pages built on the
   application base.

   Two things, both about the shell rather than the conversation: each menu opens
   and closes, and the ask bar does not submit.

   The cancelled submit is deliberate. Until the ask bar is wired to the agent,
   falling through would reload this URL as a GET, which reads as "the question
   was sent and nothing came back". Delete that handler when the flow moves onto
   the ask bar; leaving it in place afterwards would silently swallow real
   questions, which is the worse failure of the two. */
(function () {
  'use strict';

  // Every menu in the shell is the same shape: a button carrying aria-expanded,
  // and a sibling panel it hides and shows. Listing them here means a page only
  // has to supply the markup, and a third menu is one line rather than another
  // copy of this.
  var MENUS = [
    ['cp-menu-btn', 'cp-menu'],
    ['cp-account-btn', 'cp-account-menu']
  ];

  var closeAll = [];

  function wire(buttonId, menuId) {
    var button = document.getElementById(buttonId);
    var menu = document.getElementById(menuId);
    if (!button || !menu) return;

    function close() {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }
    closeAll.push(close);

    button.addEventListener('click', function (event) {
      // Stop the document listener below from seeing this click and closing the
      // menu in the same tick it was opened.
      event.stopPropagation();
      var willOpen = menu.hidden;
      // Only one menu is open at a time, so opening this one dismisses the other.
      closeAll.forEach(function (other) {
        if (other !== close) other();
      });
      menu.hidden = !willOpen;
      button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });

    document.addEventListener('click', function (event) {
      if (menu.hidden) return;
      if (menu.contains(event.target) || button.contains(event.target)) return;
      close();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') close();
    });
  }

  MENUS.forEach(function (pair) {
    wire(pair[0], pair[1]);
  });

  var askForm = document.getElementById('cp-ask');
  if (askForm && askForm.getAttribute('data-submit') !== 'live') {
    // Only a composer with nowhere to send cancels its submit. A composer that
    // has been wired to the ask path opts out with `data-submit="live"`, where
    // the handler that would swallow the question is the worse failure.
    askForm.addEventListener('submit', function (event) {
      event.preventDefault();
    });
  }
})();
