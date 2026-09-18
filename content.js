/*
 * CTA Shop Order Labor Time Guard
 *
 * Watches the IFS Cloud "Report Shop Order Operations" flyout. As soon as it
 * opens, flashes a warning, auto-zeroes every "Labor Time to Report" field,
 * and then requires the user to hover over each field to confirm it before
 * the flyout's OK button is unblocked. Any field that isn't zero is
 * red-outlined; zero-but-unconfirmed fields are amber; confirmed fields are
 * green.
 */
(function () {
  'use strict';

  const LABOR_FIELD_LABEL = 'Labor Time to Report';
  const BANNER_ID = 'cta-labor-warning-banner';
  const SUPERVISOR_OVERLAY_ID = 'cta-supervisor-overlay';

  let currentFlyout = null;
  let structureObserver = null;
  let autoZeroAttempted = new WeakSet(); // cells we've already tried to auto-zero this flyout session
  let confirmedCells = new WeakSet(); // cells the user has hovered while they read zero
  let lastValueByCell = new WeakMap(); // detects "value changed since last confirm" to un-confirm

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

  function getCellInput(cell) {
    return cell.querySelector('input[aria-label="' + LABOR_FIELD_LABEL + '"]')
      || cell.querySelector('input[role="textbox"]');
  }

  // Returns a numeric value, or null if the cell's value could not be
  // parsed (treated as "not confirmed zero" -> flagged, never silently ok).
  function readCellValue(cell) {
    const input = getCellInput(cell);
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
    document.body.appendChild(banner);

    banner.classList.add('cta-flash');
    banner.addEventListener('animationend', () => banner.classList.remove('cta-flash'));

    return banner;
  }

  function updateBannerText(total, zeroCount, confirmedCount) {
    const banner = document.getElementById(BANNER_ID);
    if (!banner) return;

    if (zeroCount < total) {
      banner.textContent = 'WARNING!   All Labor Time to Report values must be 0 before proceeding';
    } else if (confirmedCount < total) {
      banner.textContent =
        'WARNING!   Hover your mouse over each Labor Time to Report field to confirm it reads 0 ('
        + confirmedCount + ' of ' + total + ' confirmed)';
    } else {
      banner.textContent = 'All Labor Time to Report values confirmed at 0. You may click OK.';
    }
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

  // Best-effort simulated edit to set a cell's value to 0. IFS Aurena's
  // grid only exposes a real <input> once the cell is clicked into edit
  // mode, and commits the value back to its model on blur/Enter. This
  // drives that same sequence programmatically. It is inherently fragile
  // against a live Angular app - if it doesn't take, the cell just stays
  // red/highlighted and the user can zero it manually as before.
  function autoZeroCell(cell) {
    if (autoZeroAttempted.has(cell)) return;
    autoZeroAttempted.add(cell);

    const existingInput = getCellInput(cell);
    if (existingInput) {
      commitZero(existingInput);
      return;
    }

    const clickTarget = cell.querySelector('fnd-static-field') || cell;
    clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    let attempts = 0;
    const tryCommit = () => {
      const input = getCellInput(cell);
      if (input) {
        commitZero(input);
        return;
      }
      attempts += 1;
      if (attempts < 10) setTimeout(tryCommit, 50);
    };
    setTimeout(tryCommit, 50);
  }

  function commitZero(input) {
    input.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(input, '0');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter' }));
    input.blur();
  }

  function onCellHover(evt) {
    const cell = evt.target.closest('fnd-cell[data-fieldname="' + LABOR_FIELD_LABEL + '"]');
    if (!cell || !currentFlyout || !currentFlyout.contains(cell)) return;
    const value = readCellValue(cell);
    if (value === 0) {
      confirmedCells.add(cell);
      refreshFieldState(currentFlyout);
    }
  }

  function refreshFieldState(flyout) {
    const okButton = findOkButton(flyout);
    const cells = getLaborCells(flyout);
    let zeroCount = 0;
    let confirmedCount = 0;

    for (const cell of cells) {
      const value = readCellValue(cell);
      const isZero = value === 0;

      if (!isZero) {
        confirmedCells.delete(cell); // any edit away from zero requires re-confirming
      } else if (lastValueByCell.get(cell) !== 0) {
        confirmedCells.delete(cell); // just became zero (e.g. via auto-zero) - needs a fresh hover
      }
      lastValueByCell.set(cell, value);

      if (isZero) zeroCount += 1;
      const isConfirmed = isZero && confirmedCells.has(cell);
      if (isConfirmed) confirmedCount += 1;

      cell.classList.toggle('cta-labor-nonzero', !isZero);
      cell.classList.toggle('cta-labor-unconfirmed', isZero && !isConfirmed);
      cell.classList.toggle('cta-labor-confirmed', isConfirmed);

      if (!isZero) {
        autoZeroCell(cell);
      }
    }

    const allReady = cells.length > 0 && confirmedCount === cells.length;

    if (okButton) {
      okButton.classList.toggle('cta-ok-blocked', !allReady);
      okButton.disabled = !allReady;
      okButton.setAttribute('aria-disabled', String(!allReady));
    }

    updateBannerText(cells.length, zeroCount, confirmedCount);

    return !allReady; // "still blocked"
  }

  function onOkClickCapture(evt) {
    if (!currentFlyout) return;
    const okButton = findOkButton(currentFlyout);
    if (!okButton) return;
    if (evt.target !== okButton && !okButton.contains(evt.target)) return; // only guard the OK button itself

    const stillBlocked = refreshFieldState(currentFlyout);
    if (stillBlocked) {
      evt.preventDefault();
      evt.stopImmediatePropagation();
      showSupervisorWarning();
    }
  }

  function attachToFlyout(flyout) {
    currentFlyout = flyout;
    autoZeroAttempted = new WeakSet();
    ensureBanner();
    refreshFieldState(flyout);

    // Capture-phase listener runs before IFS's own bubble-phase click
    // handler in normal DOM event flow, so this reliably intercepts OK
    // even while the button's disabled state is being fought by Angular.
    // Scoped to the OK button only (see onOkClickCapture) so it never
    // swallows clicks meant to open a cell for editing.
    flyout.addEventListener('click', onOkClickCapture, { capture: true });
    flyout.addEventListener('mouseover', onCellHover, { capture: true });

    // Re-check on every keystroke/edit inside the flyout, since the
    // <input> element is injected/removed as cells enter/leave edit mode.
    flyout.addEventListener('input', () => refreshFieldState(flyout), { capture: true });

    // Structural changes only (cells swapping between static/edit mode).
    // Deliberately NOT observing attributes - our own class toggles below
    // would otherwise retrigger this observer in a feedback loop.
    structureObserver = new MutationObserver(() => refreshFieldState(flyout));
    structureObserver.observe(flyout, { childList: true, subtree: true });
  }

  function detachFlyout() {
    if (currentFlyout) {
      currentFlyout.removeEventListener('click', onOkClickCapture, { capture: true });
      currentFlyout.removeEventListener('mouseover', onCellHover, { capture: true });
    }
    if (structureObserver) {
      structureObserver.disconnect();
      structureObserver = null;
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
