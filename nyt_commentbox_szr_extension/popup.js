const slider    = document.getElementById('heightSlider');
const heightVal = document.getElementById('heightVal');
const expandBtn = document.getElementById('expandBtn');
const statusElem    = document.getElementById('status');

const MIN_H = 200, MAX_H = 400;

// Restore saved height (clamped to current min/max)
chrome.storage.local.get(['commentHeight'], (res) => {
  let h = res.commentHeight || 300;
  h = Math.min(MAX_H, Math.max(MIN_H, h));
  slider.value = h;
  heightVal.textContent = h + ' px';

  // Auto-run immediately when the popup opens
  run(h);
});

slider.addEventListener('input', () => {
  const h = parseInt(slider.value, 10);
  heightVal.textContent = h + ' px';
  chrome.storage.local.set({ commentHeight: h });
});

expandBtn.addEventListener('click', () => run(parseInt(slider.value, 10)));

async function run(height) {
  statusElem.className = '';
  statusElem.textContent = 'Working…';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url || !tab.url.includes('nytimes.com')) {
    statusElem.className = 'error';
    statusElem.textContent = '⚠ Navigate to an NYT article first.';
    return;
  }

  chrome.tabs.sendMessage(tab.id, { action: 'expand-comment-box', height }, (response) => {
    if (chrome.runtime.lastError) {
      statusElem.className = 'error';
      statusElem.textContent = '⚠ Could not reach the page. Try refreshing.';
      return;
    }
    if (response && response.success) {
      statusElem.className = 'success';
      statusElem.textContent = '✓ Comment box expanded!';
    } else {
      statusElem.className = 'error';
      statusElem.textContent = (response && response.error) || '⚠ Could not find the comment box.';
    }
  });
}
