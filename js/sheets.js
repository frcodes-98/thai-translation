/* ============================================================
   sheets.js — iOS-style bottom sheets

   One sheet is open at a time. Every sheet can be dismissed by
   tapping the backdrop, pressing Escape, tapping the grab handle or
   dragging that handle downwards. While a sheet is open the page
   behind it does not scroll, but the sheet's own body does, and Tab
   stays inside the panel so focus never escapes to the hidden page.
   ============================================================ */

(function (global) {
  'use strict';

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
                  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var CLOSE_MS = 360;
  var DRAG_DISMISS = 78;

  var current = null;          // the open .sheet element
  var opener = null;           // element that had focus before opening
  var closeTimer = null;
  var scrollY = 0;

  function panelOf(sheet) { return sheet.querySelector('.sheet-panel'); }

  function visibleFocusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), function (el) {
      return el.offsetWidth > 0 || el.offsetHeight > 0;
    });
  }

  function lockPage() {
    scrollY = global.scrollY || global.pageYOffset || 0;
    document.body.classList.add('sheet-open');
  }

  function unlockPage() {
    document.body.classList.remove('sheet-open');
    // some browsers clamp the scroll offset while overflow is hidden
    if ((global.scrollY || 0) !== scrollY) global.scrollTo(0, scrollY);
  }

  /**
   * open(idOrElement, { onClose })
   */
  function open(target, opts) {
    var sheet = typeof target === 'string' ? document.getElementById(target) : target;
    if (!sheet) return;

    if (current && current !== sheet) finish(current);
    clearTimeout(closeTimer);

    if (current !== sheet) opener = document.activeElement;

    current = sheet;
    sheet.__onClose = (opts && opts.onClose) || null;
    sheet.hidden = false;

    var panel = panelOf(sheet);
    panel.style.transform = '';
    panel.setAttribute('tabindex', '-1');

    lockPage();

    // let the browser paint the closed state once so the slide-up animates
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        sheet.classList.add('is-open');
        var first = sheet.querySelector('[aria-checked="true"]') ||
                    visibleFocusables(sheet.querySelector('.sheet-body'))[0];
        (first || panel).focus({ preventScroll: true });
      });
    });
  }

  function finish(sheet) {
    sheet.hidden = true;
    sheet.classList.remove('is-open', 'is-dragging');
    var panel = panelOf(sheet);
    panel.style.transform = '';
    panel.removeAttribute('tabindex');
  }

  function close() {
    if (!current) return;

    var sheet = current;
    var cb = sheet.__onClose;
    current = null;
    sheet.__onClose = null;

    sheet.classList.remove('is-open', 'is-dragging');
    panelOf(sheet).style.transform = '';
    unlockPage();

    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () {
      if (current !== sheet) finish(sheet);
    }, CLOSE_MS);

    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    opener = null;
    if (cb) cb();
  }

  function isOpen(target) {
    if (!target) return !!current;
    var sheet = typeof target === 'string' ? document.getElementById(target) : target;
    return current === sheet;
  }

  /* ---------------- dismiss wiring ---------------- */

  var suppressClick = false;

  document.addEventListener('click', function (e) {
    if (suppressClick) return;
    var hit = e.target.closest && e.target.closest('[data-sheet-close]');
    if (hit && current && current.contains(hit)) close();
  });

  document.addEventListener('keydown', function (e) {
    if (!current) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }

    if (e.key !== 'Tab') return;

    var items = visibleFocusables(current);
    if (!items.length) return;

    var first = items[0];
    var last = items[items.length - 1];
    var active = document.activeElement;

    if (!current.contains(active)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });

  /* ---------------- drag the handle down ---------------- */

  document.addEventListener('pointerdown', function (e) {
    var handle = e.target.closest && e.target.closest('.sheet-handle');
    if (!handle || !current || !current.contains(handle)) return;

    var panel = panelOf(current);
    var sheet = current;
    var startY = e.clientY;
    var dy = 0;
    var moved = false;

    function move(ev) {
      dy = Math.max(0, ev.clientY - startY);
      if (!moved && dy > 6) {
        moved = true;
        sheet.classList.add('is-dragging');
      }
      if (moved) panel.style.transform = 'translateY(' + dy + 'px)';
    }

    function up() {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);

      sheet.classList.remove('is-dragging');

      if (moved) {
        suppressClick = true;
        setTimeout(function () { suppressClick = false; }, 0);
      }

      if (dy > DRAG_DISMISS) {
        close();
      } else {
        panel.style.transform = '';
      }
    }

    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  });

  global.Sheets = { open: open, close: close, isOpen: isOpen };
})(window);
