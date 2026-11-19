// Swipe sideways on a main screen to reach the next tab (Today, Food, Train,
// Progress, in the bottom bar's order), the way tabbed apps work. The page
// follows the finger, rubber-bands at either end, and on release past the
// line the old tab slides out and the new one slides in from the side it was
// pulled from.
//
// It never takes a gesture that isn't its own: a touch that starts near the
// screen's left or right edge belongs to the phone's back gesture; inputs, a
// chart being read by dragging, a row's swipe-to-delete, a sideways scroller
// and an open sheet keep their own moves.
//
// Touch events, not pointer events: the browser cancels pointer events the
// moment it decides a drag is a scroll (see pullToRefresh.ts), and a
// non-passive touchmove can still stop the page scrolling while it's pulled.
//
// Usage: <main use:swipeTabs={{ tabs, current: () => location.pathname, go, onSwipe }}>

export type SwipeDir = 'next' | 'prev';

const EDGE = 24; // px from each side left to the phone's back gesture

/** Does a finished drag move to the next or previous tab? Far (a third of the
 *  screen) or fast (a flick), and clearly more sideways than up or down. */
export function swipeVerdict(dx: number, dy: number, ms: number, width: number): SwipeDir | null {
  const ax = Math.abs(dx);
  if (ax < 40 || ax < 1.5 * Math.abs(dy)) return null;
  const far = ax > width / 3;
  const fast = ax / Math.max(ms, 1) > 0.45;
  if (!far && !fast) return null;
  return dx < 0 ? 'next' : 'prev';
}

/** The tab a swipe lands on; null at either end, and off the tabs. */
export function neighbourTab(path: string, dir: SwipeDir, tabs: readonly string[]): string | null {
  const i = tabs.indexOf(path);
  if (i < 0) return null;
  const j = dir === 'next' ? i + 1 : i - 1;
  return j >= 0 && j < tabs.length ? tabs[j] : null;
}

/** A touch this close to a side is the phone's own back gesture. */
export const atEdge = (x: number, width: number): boolean => x < EDGE || x > width - EDGE;

/** Something under the finger has its own sideways gesture. */
function ownsSideways(target: EventTarget | null, root: HTMLElement): boolean {
  for (let el = target as HTMLElement | null; el && el !== root; el = el.parentElement) {
    if (el.matches?.('input, textarea, select, [contenteditable="true"], [data-own-swipe], .moverlay')) return true;
    const ox = getComputedStyle(el).overflowX;
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1) return true;
  }
  return false;
}

export interface SwipeTabsOptions {
  /** Tab paths, in the bottom bar's order. */
  tabs: readonly string[];
  /** The path showing now. */
  current: () => string;
  /** Open a tab. */
  go: (path: string) => Promise<unknown>;
  /** A swipe landed (a haptic tick). */
  onSwipe?: () => void;
}

export function swipeTabs(node: HTMLElement, opts: SwipeTabsOptions) {
  let o = opts;
  let tracking = false;
  let busy = false;
  let axis: 'x' | 'y' | null = null;
  let x0 = 0, y0 = 0, t0 = 0, x = 0, y = 0;

  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  function place(px: number, opacity: number, ms: number) {
    node.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2,.8,.2,1), opacity ${ms}ms linear` : 'none';
    node.style.transform = px ? `translate3d(${px}px,0,0)` : '';
    node.style.opacity = opacity >= 1 ? '' : String(opacity);
  }

  function start(e: TouchEvent) {
    tracking = false;
    if (busy || e.touches.length !== 1) return;
    const t = e.touches[0];
    if (!o.tabs.includes(o.current()) || atEdge(t.clientX, innerWidth) || ownsSideways(e.target, node)) return;
    tracking = true;
    axis = null;
    x0 = x = t.clientX;
    y0 = y = t.clientY;
    t0 = e.timeStamp;
  }

  function move(e: TouchEvent) {
    if (!tracking || e.touches.length !== 1) return;
    const t = e.touches[0];
    x = t.clientX;
    y = t.clientY;
    const dx = x - x0, dy = y - y0;
    if (!axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      if (axis === 'y') { tracking = false; return; } // a scroll: leave it alone
    }
    if (e.cancelable) e.preventDefault(); // the page doesn't scroll while it's pulled sideways
    const more = neighbourTab(o.current(), dx < 0 ? 'next' : 'prev', o.tabs);
    place(more ? dx : dx * 0.25, 1, 0); // rubber band at either end
  }

  async function end(e: TouchEvent) {
    if (!tracking) return;
    tracking = false;
    if (axis !== 'x') return;
    const dir = swipeVerdict(x - x0, y - y0, e.timeStamp - t0, innerWidth);
    const to = dir && neighbourTab(o.current(), dir, o.tabs);
    if (!to) { place(0, 1, 220); return; }
    busy = true;
    o.onSwipe?.();
    const out = dir === 'next' ? -innerWidth : innerWidth;
    try {
      if (!still()) { place(out * 0.4, 0, 140); await wait(140); }
      await o.go(to);
      node.scrollTop = 0;
      if (still()) place(0, 1, 0);
      else {
        place(-out * 0.25, 0, 0); // the new tab starts on the side it comes from
        node.getBoundingClientRect(); // so the slide starts from there
        place(0, 1, 220);
      }
    } finally {
      busy = false;
    }
  }

  function cancel() {
    if (!tracking) return;
    tracking = false;
    if (axis === 'x') place(0, 1, 220);
  }

  node.addEventListener('touchstart', start, { passive: true });
  node.addEventListener('touchmove', move, { passive: false });
  node.addEventListener('touchend', end);
  node.addEventListener('touchcancel', cancel);

  return {
    update(next: SwipeTabsOptions) { o = next; },
    destroy() {
      node.removeEventListener('touchstart', start);
      node.removeEventListener('touchmove', move);
      node.removeEventListener('touchend', end);
      node.removeEventListener('touchcancel', cancel);
    },
  };
}
