/** Closes a popover on a press outside its anchor (the popover's parent), or on Escape. */
export function dismiss(node: HTMLElement, close: () => void) {
  const outside = (e: PointerEvent) => {
    if (!node.parentElement?.contains(e.target as Node)) close();
  };
  const escape = (e: KeyboardEvent) => e.key === 'Escape' && close();
  // Attached a tick late, so the press that opened the popover does not close it again.
  const timer = setTimeout(() => window.addEventListener('pointerdown', outside), 0);
  window.addEventListener('keydown', escape);
  return {
    destroy() {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', escape);
    },
  };
}
