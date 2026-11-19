// Swipe sideways on a main screen to reach the next tab (Today, Food, Train,
// Progress, in the bottom bar's order), the way native tabbed apps work. The
// tabs sit side by side in one strip (+layout.svelte), each built once and
// kept, so the next tab is already there and shows beside the finger as it
// drags; letting go only finishes the slide, at the finger's own speed, and the
// page address follows. Only the main tabs move: a page's own tabs (Food's
// Today, History, Recipes; Train's Upcoming, History) change by a tap and slide
// when they do (SwipeViews.svelte). His report, 19 Nov evening: when a swipe
// went through those first, Train was near impossible to reach from Food.
//
// It never takes a gesture that isn't its own: a touch that starts near the
// screen's left or right edge belongs to the phone's back gesture; inputs, a
// chart being read by dragging, a row's swipe-to-delete, a sideways scroller
// and an open sheet keep their own moves; a scroll that starts on an angle
// stays a scroll.
//
// Touch events, not pointer events: the browser cancels pointer events the
// moment it decides a drag is a scroll (see pullToRefresh.ts), and a
// non-passive touchmove can still stop the page scrolling while it's pulled.
//
// Usage: <div use:swipeTabs={{ tabs, current: () => location.pathname, go, prepare, onSwipe }}>
//          <div data-swipe-track>…one child per tab…</div></div>

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
  /** Open a tab (the page address follows the slide). */
  go: (path: string) => Promise<unknown>;
  /** Build a tab that isn't built yet: a swipe toward it has just started. */
  prepare?: (path: string) => void;
  /** A swipe landed (a haptic tick). */
  onSwipe?: () => void;
}

/** One planned move: the tab shown (from), the tab a swipe that way reaches
 *  (to; null: nothing that way, so the page only stretches), and its address. */
type Move = { panels: HTMLElement[]; from: number; to: number | null; path?: string };

/** A tab panel k places from the one shown, pulled dx px (k = 0: the one shown). */
const offset = (k: number, dx = 0) => `translate3d(calc(${k * 100}% + ${dx}px),0,0)`;

/** Where a tab panel rests, as the layout writes it: the one shown never moved,
 *  so its sheets (fixed to the screen) open on the screen; inside a moved
 *  element they'd be fixed to that element (19 Nov: a workout's sheet opened
 *  two screens to the left). The others wait beside it. */
const restingAt = (k: number) => (k === 0 ? null : `translateX(${k * 100}%)`);

/** Resolves when a slide has finished (or should have). */
function settle(el: HTMLElement, ms: number): Promise<void> {
  return new Promise((done) => {
    const end = () => { el.removeEventListener('transitionend', end); clearTimeout(t); done(); };
    const t = setTimeout(end, ms + 80);
    el.addEventListener('transitionend', end);
  });
}

export function swipeTabs(node: HTMLElement, opts: SwipeTabsOptions) {
  let o = opts;
  let tracking = false;
  let busy = false;
  let axis: 'x' | 'y' | null = null;
  let x0 = 0, y0 = 0, t0 = 0, x = 0, y = 0;
  let moving: Move | null = null; // the tabs following the finger now
  let beside: number | null = null; // the tab showing beside the finger now
  let prepared = '';
  let frame = 0;
  let trail: [number, number][] = []; // the last moments of the finger: [time, x]

  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Move a tab panel (null: unmoved), sliding if ms. */
  function slide(el: HTMLElement, transform: string | null, ms = 0) {
    el.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2,.9,.25,1)` : 'none';
    if (transform === null) el.style.removeProperty('transform');
    else el.style.transform = transform;
    el.style.willChange = 'transform';
  }
  /** A panel at rest: no motion hints left on it. */
  function still_(el: HTMLElement) { el.style.transition = ''; el.style.willChange = ''; }
  /** The finger's speed over its last ~60 ms, px per ms. */
  function speed(): number {
    const end = trail[trail.length - 1];
    const from = trail.find(([t]) => end[0] - t <= 60) ?? trail[0];
    return end && from && end[0] > from[0] ? Math.abs(end[1] - from[1]) / (end[0] - from[0]) : 0;
  }

  const mainTrack = () => node.querySelector<HTMLElement>(':scope > [data-swipe-track]');
  const mainIndex = () => o.tabs.indexOf(o.current());

  /** Where a swipe that way leads: the next or previous main tab. */
  function plan(dir: SwipeDir): Move | null {
    const track = mainTrack();
    const from = mainIndex();
    if (!track || from < 0) return null;
    const path = neighbourTab(o.current(), dir, o.tabs);
    return { panels: [...track.children] as HTMLElement[], from, to: path ? from + (dir === 'next' ? 1 : -1) : null, path: path ?? undefined };
  }

  /** Put the tabs back where they rest. */
  async function rest(m: Move, ms = 220) {
    const cur = m.panels[m.from];
    const nb = beside;
    beside = null;
    slide(cur, offset(0), ms);
    if (nb !== null) slide(m.panels[nb], offset(nb - m.from), ms);
    await settle(cur, ms);
    slide(cur, null);
    still_(cur);
    if (nb !== null) { slide(m.panels[nb], restingAt(nb - m.from)); still_(m.panels[nb]); }
  }

  function start(e: TouchEvent) {
    tracking = false;
    if (busy || e.touches.length !== 1) return;
    const t = e.touches[0];
    if (!o.tabs.includes(o.current()) || atEdge(t.clientX, innerWidth) || ownsSideways(e.target, node)) return;
    tracking = true;
    axis = null;
    moving = null;
    beside = null;
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
      const m = plan(dx < 0 ? 'next' : 'prev');
      if (!m) return;
      if (beside !== null && beside !== m.to) { // turned back: that neighbour goes home
        slide(m.panels[beside], restingAt(beside - m.from));
        still_(m.panels[beside]);
        beside = null;
      }
      moving = m;
      if (m.path && m.path !== prepared) { prepared = m.path; o.prepare?.(m.path); }
      const pull = m.to === null ? dx * 0.25 : dx; // rubber band at either end
      slide(m.panels[m.from], offset(0, pull));
      if (m.to !== null) { slide(m.panels[m.to], offset(m.to - m.from, pull)); beside = m.to; }
    });
  }

  async function end(e: TouchEvent) {
    if (!tracking) return;
    tracking = false;
    cancelAnimationFrame(frame);
    if (axis !== 'x') return;
    const dir = swipeVerdict(x - x0, y - y0, e.timeStamp - t0, innerWidth);
    const m = dir && plan(dir);
    if (!m || m.to === null || m.to !== beside) { if (moving) await rest(moving); moving = null; return; }
    busy = true;
    o.onSwipe?.();
    const cur = m.panels[m.from], next = m.panels[m.to];
    try {
      const ms = still() ? 0 : swipeDuration(x - x0, speed(), innerWidth);
      slide(cur, offset(m.from - m.to), ms); // the tab shown leaves
      slide(next, offset(0), ms); // the next one arrives
      await settle(cur, ms);
      if (m.path) await o.go(m.path);
    } finally {
      // At rest as the layout places them: the tab shown unmoved, the other beside it.
      const landed = o.current() === m.path;
      slide(next, landed ? null : restingAt(m.to - m.from));
      slide(cur, landed ? restingAt(m.from - m.to) : null);
      still_(next);
      still_(cur);
      moving = null;
      beside = null;
      busy = false;
    }
  }

  function cancel() {
    if (!tracking) return;
    tracking = false;
    cancelAnimationFrame(frame);
    if (axis === 'x' && moving) void rest(moving);
    moving = null;
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
