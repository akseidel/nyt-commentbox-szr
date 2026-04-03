/**
 * NYT New Comment Expander — content script (top frame only)
 *
 * The comment input is a <textarea> inside #commentsContainer.
 * Before the user clicks into it, only a placeholder element exists.
 * After clicking, NYT creates the textarea dynamically.
 */

/* ------------------------------------------------------------------ */
/* Find the textarea (only exists after activation)                     */
/* ------------------------------------------------------------------ */

function findTextarea() {
  // Primary anchor: the stable #commentsContainer id
  const inContainer = document.querySelector('#commentsContainer textarea');
  if (inContainer) return inContainer;

  // Fallback: any visible textarea that isn't the site search box
  for (const ta of document.querySelectorAll('textarea')) {
    if (ta.getAttribute('name') === 'query') continue; // search input
    if (ta.offsetParent !== null) return ta;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Find the pre-activation placeholder to click                         */
/* ------------------------------------------------------------------ */

function findPlaceholder() {
  // Exact data-testid confirmed by DOM inspection
  const byTestId = document.querySelector('[data-testid="comment-prompt-entry-opener"]');
  if (byTestId) return byTestId;

  // Fallback: the wrapping prompt container
  const byPrompt = document.querySelector('[data-testid="comment-prompt"]');
  if (byPrompt) return byPrompt;

  // Broader fallback: any element with role="textbox" inside commentsContainer
  // that isn't the actual textarea yet
  const container = document.getElementById('commentsContainer') || document.body;
  const roleTextbox = container.querySelector('[role="textbox"]:not(textarea)');
  if (roleTextbox) return roleTextbox;

  return null;
}

/* ------------------------------------------------------------------ */
/* Height enforcement                                                   */
/* ------------------------------------------------------------------ */

function applyHeight(el, px) {
  el.style.setProperty('height',     px + 'px', 'important');
  el.style.setProperty('min-height', px + 'px', 'important');
  el.style.setProperty('max-height', 'none',    'important');
  el.style.setProperty('overflow-y', 'auto',    'important');
  el.style.setProperty('resize',     'vertical'           ); // no !important — user can drag
}

function watchHeight(el, px) {
  if (el._nytWatched) return;
  el._nytWatched = true;

  let dragging = false;
  el.addEventListener('mousedown', () => { dragging = true; });
  window.addEventListener('mouseup', () => { dragging = false; }, true);

  new MutationObserver(() => {
    if (dragging) return;
    if (parseInt(getComputedStyle(el).height, 10) < px - 10) {
      applyHeight(el, px); // only restore if NYT shrinks it
    }
  }).observe(el, { attributes: true, attributeFilter: ['style'] });
}

/* ------------------------------------------------------------------ */
/* Trigger a React onClick handler directly via the fiber tree,        */
/* bypassing the event system (works even when isTrusted checks fail)  */
/* ------------------------------------------------------------------ */

function triggerReactClick(el) {
  // React 16+ stores fiber under a key like __reactFiber$xxxxx
  // React <16 used __reactInternalInstance$xxxxx
  const fiberKey = Object.keys(el).find(
    k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
  );
  if (!fiberKey) return false;

  // Walk the fiber tree upward looking for an onClick prop
  let fiber = el[fiberKey];
  while (fiber) {
    const props = fiber.memoizedProps || fiber.pendingProps || {};
    if (typeof props.onClick === 'function') {
      // Construct a minimal synthetic-event-like object
      props.onClick({
        type:          'click',
        target:        el,
        currentTarget: el,
        bubbles:       true,
        cancelable:    true,
        defaultPrevented: false,
        preventDefault:   () => {},
        stopPropagation:  () => {},
        nativeEvent:   new MouseEvent('click', { bubbles: true }),
      });
      return true;
    }
    fiber = fiber.return;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Simulate a click via multiple strategies, most-reliable first       */
/* ------------------------------------------------------------------ */

function simulateClick(el) {
  el.scrollIntoView({ behavior: 'instant', block: 'center' });

  // Strategy 1: directly invoke the React onClick fiber prop
  if (triggerReactClick(el)) return;

  // Strategy 2: PointerEvent sequence (closer to real touch/click)
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width  / 2;
  const cy = rect.top  + rect.height / 2;
  const shared = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };

  try {
    el.dispatchEvent(new PointerEvent('pointerover',  { ...shared, isPrimary: true }));
    el.dispatchEvent(new PointerEvent('pointerenter', { ...shared, isPrimary: true, bubbles: false }));
    el.dispatchEvent(new PointerEvent('pointerdown',  { ...shared, isPrimary: true }));
    el.dispatchEvent(new PointerEvent('pointerup',    { ...shared, isPrimary: true }));
  } catch (_) {}

  // Strategy 3: MouseEvent sequence
  el.dispatchEvent(new MouseEvent('mousedown', { ...shared, buttons: 1, button: 0, view: window }));
  el.dispatchEvent(new MouseEvent('mouseup',   { ...shared, buttons: 0, button: 0, view: window }));
  el.dispatchEvent(new MouseEvent('click',     { ...shared, buttons: 0, button: 0, view: window }));

  // Strategy 4: native .click() as last resort
  el.click();

  if (typeof el.focus === 'function') el.focus();
}

/* ------------------------------------------------------------------ */
/* Main                                                                 */
/* ------------------------------------------------------------------ */

function expandCommentBox(px, sendResponse) {
  // Case 1: textarea already in DOM (user already clicked into it)
  const existing = findTextarea();
  if (existing) {
    existing.focus();
    applyHeight(existing, px);
    watchHeight(existing, px);
    existing.scrollIntoView({ behavior: 'smooth', block: 'center' });
    sendResponse({ success: true });
    return;
  }

  // Case 2: textarea not yet in DOM — find and click the placeholder
  const placeholder = findPlaceholder();
  if (!placeholder) {
    sendResponse({
      success: false,
      error: 'Comments section not found. Scroll down to it and try again.'
    });
    return;
  }

  // Dispatch a full mouse-event sequence so React's synthetic event
  // system sees a real interaction, not just a programmatic .click()
  simulateClick(placeholder);

  // Poll up to 3 s for the textarea to appear
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    const ta = findTextarea();
    if (ta) {
      clearInterval(timer);
      ta.focus();
      applyHeight(ta, px);
      watchHeight(ta, px);
      ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
      sendResponse({ success: true });
    } else if (tries >= 30) {
      clearInterval(timer);
      sendResponse({
        success: false,
        error: 'Clicked the comments area but the input did not appear. Try again.'
      });
    }
  }, 100);
}

/* ------------------------------------------------------------------ */
/* Message listener                                                     */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'expand-comment-box') {
    expandCommentBox(msg.height || 420, sendResponse);
    return true; // keep channel open for async response
  }
});
