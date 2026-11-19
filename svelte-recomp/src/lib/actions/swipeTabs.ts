// Swipe sideways on a main screen to reach the next tab (Today, Food, Train,
// Progress, in the bottom bar's order), the way tabbed apps work. The page
// follows the finger, rubber-bands at either end, and on release past the
// line the old tab slides out and the new one slides in from the side it was
// pulled from. A page with its own tab row ([data-swipe-tabs]: Food's Today,
// History, Recipes; Train's Upcoming, History) is swiped through first, and
// past either end of it the main tabs take over.
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

const SLOP = 12; // px a finger moves before its direction counts

/** Sideways only when clearly so: more than twice as sideways as up or down
 *  (the rule Android's own swipeable pages use). A thumb that starts a scroll
 *  on a slight angle stays a scroll. null: not moved far enough to tell. */
export function swipeAxis(dx: number, dy: number): 'x' | 'y' | null {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < SLOP && ay < SLOP) return null;
  return ax > 2 * ay ? 'x' : 'y';
}

/** A page's own tab row (Food: Today, History, Recipes): the tab a swipe moves
 *  to, or null past either end, where the main tabs take over. */
export function innerStep(i: number, n: number, dir: SwipeDir): number | null {
  const j = dir === 'next' ? i + 1 : i - 1;
  return j >= 0 && j < n ? j : null;
}

/** Something under the finger has its own sideways gesture. */
function ownsSideways(target: EventTarget | null, root: HTMLElement): boolean {
  for (let el = target as HTMLElement | null; el && el !== root; el = el.parentElement) {
    if (el.matches?.('input, textarea, select, [contenteditable="true"], [data-own-swipe], .moverlay')) return true;
    const ox = getComputedStyle(el).overflowX;
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1) return true;
  }
  return false;
}

/** How long the release takes: the rest of the way at the finger's own speed
 *  (px per ms), never a snap and never a crawl. */
export function swipeDuration(fromPx: number, speed: number, width: number): number {
  const left = Math.max(0, width - Math.abs(fromPx));
  return Math.round(Math.min(340, Math.max(180, left / Math.max(speed, 0.5))));
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

type Target = { inner: HTMLElement } | { path: string };
type Transition = { ready: Promise<void>; updateCallbackDone: Promise<void>; finished: Promise<void> };
const quiet = () => {};

export function swipeTabs(node: HTMLElement, opts: SwipeTabsOptions) {
  let o = opts;
  let tracking = false;
  let busy = false;
  let axis: 'x' | 'y' | null = null;
  let x0 = 0, y0 = 0, t0 = 0, x = 0, y = 0;
  let mover: HTMLElement = node; // what follows the finger: the whole page, or only the content under its tab row
  let shown = 0; // px the mover sits off centre now
  let frame = 0;
  let trail: [number, number][] = []; // the last moments of the finger: [time, x]

  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function place(el: HTMLElement, px: number, ms = 0) {
    if (el !== mover) { mover.style.transform = ''; mover.style.willChange = ''; mover = el; }
    shown = px;
    el.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2,.9,.25,1)` : 'none';
    el.style.transform = px ? `translate3d(${px}px,0,0)` : '';
    el.style.willChange = px ? 'transform' : '';
  }
  /** The finger's speed over its last ~60 ms, px per ms. */
  function speed(): number {
    const end = trail[trail.length - 1];
    const from = trail.find(([t]) => end[0] - t <= 60) ?? trail[0];
    return end && from && end[0] > from[0] ? Math.abs(end[1] - from[1]) / (end[0] - from[0]) : 0;
  }

  /** This page's own tab row, if it has one on screen ([data-swipe-tabs] with role="tab" buttons). */
  function row(): { list: HTMLElement; tabs: HTMLElement[]; i: number } | null {
    const list = node.querySelector<HTMLElement>('[data-swipe-tabs]');
    if (!list?.offsetParent) return null;
    const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
    const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    return i < 0 ? null : { list, tabs, i };
  }

  /** Where a swipe that way leads: the page's own next tab, else the next main tab. */
  function target(dir: SwipeDir): Target | null {
    const r = row();
    const j = r && innerStep(r.i, r.tabs.length, dir);
    if (r && j !== null) return { inner: r.tabs[j] };
    const path = neighbourTab(o.current(), dir, o.tabs);
    return path ? { path } : null;
  }

  /** A page's own tabs slide only the content under the row ([data-swipe-panel]); main tabs slide the page. */
  const moverFor = (to: Target | null) =>
    to && 'inner' in to ? node.querySelector<HTMLElement>('[data-swipe-panel]') ?? node : node;

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
    trail = [[e.timeStamp, x]];
  }

  function move(e: TouchEvent) {
    if (!tracking || e.touches.length !== 1) return;
    const t = e.touches[0];
    x = t.clientX;
    y = t.clientY;
    trail.push([e.timeStamp, x]);
    if (trail.length > 8) trail.shift();
    const dx = x - x0, dy = y - y0;
    if (!axis) {
      axis = swipeAxis(dx, dy);
      if (!axis) return;
      if (axis === 'y') { tracking = false; return; } // a scroll: leave it alone
    }
    if (e.cancelable) e.preventDefault(); // the page doesn't scroll while it's pulled sideways
    // One move per frame, however fast the screen reports the finger.
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const to = target(dx < 0 ? 'next' : 'prev');
      place(moverFor(to), to ? dx : dx * 0.25); // rubber band at either end
    });
  }

  /** Open where the swipe leads. No waiting for a frame here: while a view
   *  transition waits for this, the browser draws none (it froze 4 s, 19 Nov). */
  async function open(to: Target) {
    if ('inner' in to) {
      const r = row();
      to.inner.click();
      await new Promise((done) => setTimeout(done, 0));
      // Keep the tab row in sight if the page was scrolled past it.
      const top = r ? r.list.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop - 8 : 0;
      if (node.scrollTop > top) node.scrollTop = Math.max(0, top);
    } else {
      await o.go(to.path);
      node.scrollTop = 0;
    }
  }

  async function end(e: TouchEvent) {
    if (!tracking) return;
    tracking = false;
    cancelAnimationFrame(frame);
    if (axis !== 'x') return;
    const dir = swipeVerdict(x - x0, y - y0, e.timeStamp - t0, innerWidth);
    const to = dir && target(dir);
    if (!to) { place(mover, 0, 220); return; }
    busy = true;
    o.onSwipe?.();
    const root = document.documentElement;
    const el = moverFor(to);
    const from = el === mover ? shown : 0;
    const doc = document as Document & { startViewTransition?: (update: () => Promise<void>) => Transition };
    try {
      if (still() || !doc.startViewTransition) {
        place(el, 0);
        await open(to);
        return;
      }
      // One motion: the old tab carries on from where the finger let go, and the
      // new one arrives right beside it (app.css, tab-out-* and tab-in-*).
      root.style.setProperty('--swipe-from', `${from}px`);
      root.style.setProperty('--swipe-ms', `${swipeDuration(from, speed(), innerWidth)}ms`);
      root.dataset.swipe = dir;
      place(el, 0); // captured centred; the animation starts it at --swipe-from
      el.style.viewTransitionName = 'tab-page';
      const t = doc.startViewTransition(() => open(to));
      t.ready.catch(quiet); // a skipped transition is no error: the tab still opens
      t.updateCallbackDone.catch(quiet);
      await t.finished.catch(quiet);
    } finally {
      el.style.viewTransitionName = '';
      delete root.dataset.swipe;
      busy = false;
    }
  }

  function cancel() {
    if (!tracking) return;
    tracking = false;
    cancelAnimationFrame(frame);
    if (axis === 'x') place(mover, 0, 220);
  }

  node.addEventListener('touchstart', start, { passive: true });
  node.addEventListener('touchmove', move, { passive: false });
  node.addEventListener('touchend', end);
  node.addEventListener('touchcancel', cancel);

  return {
    update(next: SwipeTabsOptions) { o = next; },
    destroy() {
      cancelAnimationFrame(frame);
      node.removeEventListener('touchstart', start);
      node.removeEventListener('touchmove', move);
      node.removeEventListener('touchend', end);
      node.removeEventListener('touchcancel', cancel);
    },
  };
}
