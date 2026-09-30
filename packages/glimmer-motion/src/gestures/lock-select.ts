/**
 * Pointer-drag selects nearby text in the browser unless we opt out for the
 * whole document — CSS on the dragged node is not enough once the pointer
 * leaves it.
 */
let locks = 0;
let onSelectStart: ((event: Event) => void) | null = null;

export function lockTextSelect() {
  locks += 1;
  if (locks !== 1) {
    return;
  }

  const root = document.documentElement;
  root.dataset.gmDragging = '';
  root.style.setProperty('user-select', 'none');
  root.style.setProperty('-webkit-user-select', 'none');
  window.getSelection()?.removeAllRanges();
  onSelectStart = (event) => event.preventDefault();
  document.addEventListener('selectstart', onSelectStart, true);
}

export function unlockTextSelect() {
  locks = Math.max(0, locks - 1);
  if (locks !== 0) {
    return;
  }

  const root = document.documentElement;
  delete root.dataset.gmDragging;
  root.style.removeProperty('user-select');
  root.style.removeProperty('-webkit-user-select');
  if (onSelectStart) {
    document.removeEventListener('selectstart', onSelectStart, true);
    onSelectStart = null;
  }
}
