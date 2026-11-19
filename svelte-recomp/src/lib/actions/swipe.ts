// Reusable swipe-to-reveal-actions gesture for list rows (alarms, food log
// entries, checklist items, etc). Horizontal drag reveals one or more
// action buttons (e.g. Delete/Edit) tucked behind the row; the row snaps
// back if not dragged past a threshold. This exists because small inline
// buttons are hard to hit reliably on a phone -- a swipe gesture across
// the whole row is a much bigger, more forgiving target.
//
// Usage:
//   <div use:swipeActions={{ onOffset: (px) => offset = px, onSettle: (open) => revealed = open }} style="position:relative">
//     <div class="swipe-actions">...buttons...</div>
//     <div class="swipe-content" style="transform:translateX({offset}px)">...row content...</div>
//   </div>
export interface SwipeOptions {
  onOffset: (px: number) => void;
  onSettle: (revealed: boolean) => void;
  maxReveal?: number; // px of action area to reveal, default 72
  threshold?: number; // px drag needed to "snap open", default maxReveal/2
}

export function swipeActions(node: HTMLElement, opts: SwipeOptions) {
  node.dataset.ownSwipe = ''; // the tab swipe (swipeTabs.ts) leaves this row's sideways drag alone
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let axisLocked: 'x' | 'y' | null = null;
  let current = opts;

  const maxReveal = () => current.maxReveal ?? 72;
  const threshold = () => current.threshold ?? maxReveal() / 2;

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    dragging = true;
    axisLocked = null;
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!axisLocked) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      axisLocked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (axisLocked === 'x') (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (axisLocked !== 'x') return;

    e.preventDefault();
    // Only allow revealing leftward (negative offset), clamp to maxReveal.
    const clamped = Math.max(-maxReveal(), Math.min(0, dx));
    current.onOffset(clamped);
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    if (axisLocked !== 'x') { axisLocked = null; return; }
    const dx = e.clientX - startX;
    const revealed = dx < -threshold();
    current.onOffset(revealed ? -maxReveal() : 0);
    current.onSettle(revealed);
    axisLocked = null;
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove, { passive: false });
  node.addEventListener('pointerup', onPointerUp);
  node.addEventListener('pointercancel', onPointerUp);

  return {
    update(newOpts: SwipeOptions) { current = newOpts; },
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', onPointerUp);
      node.removeEventListener('pointercancel', onPointerUp);
    },
  };
}
