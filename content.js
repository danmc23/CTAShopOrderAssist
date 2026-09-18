/*
 * CTA Shop Order Labor Time Guard
 *
 * Watches the IFS Cloud "Report Shop Order Operations" flyout. As soon as it
 * opens, flashes and then persistently displays a warning that all
 * "Labor Time to Report" values must be zero, red-outlines any cell that is
 * not currently zero, and blocks the flyout's OK button until every value
 * reads zero.
 */
(function () {
  'use strict';

  const LABOR_FIELD_LABEL = 'Labor Time to Report';
  const BANNER_ID = 'cta-labor-warning-banner';
  const SUPERVISOR_OVERLAY_ID = 'cta-supervisor-overlay';

  let currentFlyout = null;
  let fieldObserver = null;

  function findFlyoutRoot() {
    // fnd-modal-assistant ids are page-specific (built from the assistant
    // name), so we don't hardcode "ReportShopOrderOperationAssistant" here.
    // Instead we match any open modal assistant that actually contains a
    // "Labor Time to Report" field, which scopes us to the right flyout
    // without depending on a page-specific id.
    const candidates = document.querySelectorAll(
      'fnd-modal-assistant[id^="fndModalAssistantshell-"]'
    );
    for (const candidate of candidates) {
      if (getLaborCells(candidate).length > 0) {
        return candidate;
      }
    }
    return null;
  }

  function getLaborCells(root) {
    return Array.from(
      root.querySelectorAll('fnd-cell[data-fieldname="' + LABOR_FIELD_LABEL + '"]')
    );
  }

  function findOkButton(root) {
    return root.querySelector(
      'button[title="OK"].granite-toolbar-button, button.granite-toolbar-button[title="OK"]'
    ) || Array.from(root.querySelectorAll('button.granite-toolbar-button')).find(
      (b) => b.getAttribute('title') === 'OK'
    ) || null;
  }

  // Returns a numeric value, or null if the cell's value could not be
  // parsed (treated as "not confirmed zero" -> flagged, never silently ok).
  function readCellValue(cell) {
    const input = cell.querySelector('input[aria-label="' + LABOR_FIELD_LABEL + '"]')
      || cell.querySelector('input[role="textbox"]');
    if (input) {
      const raw = input.value.trim();
      if (raw === '') return null;
      const n = parseFloat(raw);
      return Number.isNaN(n) ? null : n;
    }

    const staticSpan = cell.querySelector('fnd-static-field span');
    if (staticSpan) {
      const raw = (staticSpan.getAttribute('title') || staticSpan.textContent || '').trim();
      if (raw === '') return 0; // empty static cell reads as no time reported
      const n = parseFloat(raw);
      return Number.isNaN(n) ? null : n;
    }

    return null;
  }

  function ensureBanner() {
    let banner = document.getElementById(BANNER_ID);
    if (banner) return banner;

    banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.textContent = 'WARNING!   All Labor Time to Report values must be 0 before proceeding';
    document.body.appendChild(banner);

    banner.classList.add('cta-flash');
    banner.addEventListener('animationend', () => banner.classList.remove('cta-flash'));

    return banner;
  }

  function removeBanner() {
    const banner = document.getElementById(BANNER_ID);
    if (banner) banner.remove();
  }

  function showSupervisorWarning() {
    if (document.getElementById(SUPERVISOR_OVERLAY_ID)) return;

    const overlay = document.createElement('div');
    overlay.id = SUPERVISOR_OVERLAY_ID;
    overlay.innerHTML =
      '<div id="cta-supervisor-modal">' +
      '<h2>STOP</h2>' +
      '<p>Labor Time to Report values were left greater than zero. ' +
      'You must alert your Supervisor to correct this transaction.</p>' +
      '<button type="button">Acknowledge</button>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.querySelector('button').addEventListener('click', () => overlay.remove());
  }

  function refreshFieldState(flyout) {
    const okButton = findOkButton(flyout);
    let anyNonZero = false;

    for (const cell of getLaborCells(flyout)) {
      const value = readCellValue(cell);
      const isNonZero = value === null || value !== 0;
      cell.classList.toggle('cta-labor-nonzero', isNonZero);
      if (isNonZero) anyNonZero = true;
    }

    if (okButton) {
      okButton.classList.toggle('cta-ok-blocked', anyNonZero);
      okButton.disabled = anyNonZero;
      okButton.setAttribute('aria-disabled', String(anyNonZero));
    }

    return anyNonZero;
  }

  function onOkClickCapture(evt) {
    if (!currentFlyout) return;
    const anyNonZero = refreshFieldState(currentFlyout);
    if (anyNonZero) {
      evt.preventDefault();
      evt.stopImmediatePropagation();
      showSupervisorWarning();
    }
  }

  function attachToFlyout(flyout) {
    currentFlyout = flyout;
    ensureBanner();
    refreshFieldState(flyout);

    // Capture-phase listener runs before IFS's own bubble-phase click
    // handler in normal DOM event flow, so this reliably intercepts OK
    // even while the button's disabled state is being fought by Angular.
    flyout.addEventListener('click', onOkClickCapture, { capture: true });

    // Re-check on every keystroke/edit inside the flyout, since the
    // <input> element is injected/removed as cells enter/leave edit mode.
    flyout.addEventListener('input', () => refreshFieldState(flyout), { capture: true });

    fieldObserver = new MutationObserver(() => refreshFieldState(flyout));
    fieldObserver.observe(flyout, { childList: true, subtree: true, attributes: true });
  }

  function detachFlyout() {
    if (currentFlyout) {
      currentFlyout.removeEventListener('click', onOkClickCapture, { capture: true });
    }
    if (fieldObserver) {
      fieldObserver.disconnect();
      fieldObserver = null;
    }
    currentFlyout = null;
    removeBanner();
    const overlay = document.getElementById(SUPERVISOR_OVERLAY_ID);
    if (overlay) overlay.remove();
  }

  function checkFlyoutPresence() {
    const flyout = findFlyoutRoot();

    if (flyout && flyout !== currentFlyout) {
      attachToFlyout(flyout);
    } else if (!flyout && currentFlyout) {
      detachFlyout();
    }
  }

  const mainArea = document.getElementById('main-area-wrapper') || document.body;
  new MutationObserver(checkFlyoutPresence).observe(mainArea, {
    childList: true,
    subtree: true,
  });

  checkFlyoutPresence();
})();
