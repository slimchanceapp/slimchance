// What old phone browsers lack and the app uses (2026-11-11). Google Play's
// pre-launch test phones, with WebViews older than Chrome 92, crashed Today
// on `.at()`; `crypto.randomUUID()` (onboarding, saving food) and
// `AbortSignal.timeout()` (food search) would have failed next. Installed from
// src/hooks.client.ts before any page runs; a no-op wherever they exist.
// selfcheck fails if the app starts using a newer built-in not covered here.

export function installPolyfills(g: any): void {
  function at(this: any, n: number) {
    let i = Math.trunc(n) || 0;
    if (i < 0) i += this.length;
    return i < 0 || i >= this.length ? undefined : this[i];
  }
  for (const C of [g.Array, g.String]) {
    if (C && !C.prototype.at) Object.defineProperty(C.prototype, 'at', { value: at, writable: true, configurable: true });
  }
  if (g.crypto?.getRandomValues && !g.crypto.randomUUID) {
    g.crypto.randomUUID = () => {
      const b: Uint8Array = g.crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40; // version 4
      b[8] = (b[8] & 0x3f) | 0x80; // variant 10
      const h = Array.from(b, (x) => (x + 0x100).toString(16).slice(1));
      return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
    };
  }
  if (g.AbortSignal && g.AbortController && !g.AbortSignal.timeout) {
    g.AbortSignal.timeout = (ms: number) => {
      const c = new g.AbortController();
      g.setTimeout(() => c.abort(), ms);
      return c.signal;
    };
  }
}
