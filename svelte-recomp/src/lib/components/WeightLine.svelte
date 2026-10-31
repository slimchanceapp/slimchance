<script lang="ts">
  // Progress's first answer: the line. Every morning on the scale as a dot,
  // the trend through them as the line (the same fit as every other screen,
  // stores/body.ts), the goal when it's in reach of the picture, then how far
  // along the way you are. The odds and the pace are the hero's, above.
  import { body, trendSeries } from '$lib/stores/body';
  import { changeWord, toUnit, unitWord, wtNum, wtShort, wtShortU, dwt } from '$lib/units';
  import { shiftYmd } from '$lib/date';

  let range = $state<'90' | 'all'>('90');

  const all = $derived($trendSeries);
  const spanDays = $derived(all.length > 1 ? (Date.parse(all.at(-1)!.date) - Date.parse(all[0].date)) / 86_400_000 : 0);
  const pts = $derived(range === 'all' ? all : all.filter((p) => p.date >= shiftYmd(-90, new Date(`${$body.today}T12:00:00`))));

  const W = 340, H = 190, L = 34, R = 14, T = 14, B = 22;
  const goalKg = $derived($body.goalKg);
  const chart = $derived.by(() => {
    if (pts.length < 2) return null;
    const vals = pts.flatMap((p) => (p.trendKg == null ? [p.kg] : [p.kg, p.trendKg])).map((k) => toUnit(k));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    // The goal joins the picture only when it doesn't flatten the line to a ruler.
    const goal = goalKg != null ? toUnit(goalKg) : null;
    const showGoal = goal != null && goal >= lo - (hi - lo) * 0.6 && goal <= hi + (hi - lo) * 0.6;
    if (showGoal) { lo = Math.min(lo, goal!); hi = Math.max(hi, goal!); }
    const pad = Math.max(0.3, (hi - lo) * 0.08);
    lo -= pad; hi += pad;
    const step = [0.5, 1, 2, 5, 10, 20, 50].find((s) => (hi - lo) / s <= 4) ?? 100;
    const t0 = Date.parse(pts[0].date), t1 = Date.parse(pts.at(-1)!.date);
    const x = (d: string) => L + ((Date.parse(d) - t0) / (t1 - t0 || 1)) * (W - L - R);
    const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const grid: Array<{ y: number; label: string }> = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) grid.push({ y: y(v), label: String(+v.toFixed(1)) });
    const line = pts.filter((p) => p.trendKg != null)
      .map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(toUnit(p.trendKg!)).toFixed(1)}`).join('');
    const last = [...pts].reverse().find((p) => p.trendKg != null) ?? null;
    const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const mid = pts[Math.floor(pts.length / 2)].date;
    return {
      grid, line,
      dots: pts.map((p) => ({ x: x(p.date), y: y(toUnit(p.kg)) })),
      end: last ? { x: x(last.date), y: y(toUnit(last.trendKg!)) } : null,
      goal: showGoal ? y(goal!) : null,
      xs: [{ x: L, label: day(pts[0].date), a: 'start' as const }, { x: x(mid), label: day(mid), a: 'middle' as const }, { x: W - R, label: day(pts.at(-1)!.date), a: 'end' as const }],
    };
  });

  const along = $derived.by(() => {
    const { firstKg, currentKg } = $body;
    if (firstKg == null || currentKg == null || goalKg == null || firstKg === goalKg) return null;
    const pct = Math.max(0, Math.min(1, (firstKg - currentKg) / (firstKg - goalKg)));
    return { pct, done: Math.abs(firstKg - currentKg), total: Math.abs(firstKg - goalKg) };
  });
</script>

<div class="card wl">
  <div class="flex jb ac">
    <div class="card-lbl" style="margin-bottom:0">Your line</div>
    {#if spanDays > 100}
      <div class="flex gap2">
        <button class="tab" class:on={range === '90'} onclick={() => (range = '90')}>3 months</button>
        <button class="tab" class:on={range === 'all'} onclick={() => (range = 'all')}>All</button>
      </div>
    {/if}
  </div>

  {#if chart}
    <svg viewBox="0 0 {W} {H}" width="100%" role="img"
      aria-label={`Weight from ${wtNum(pts[0].kg)} to ${wtNum(pts.at(-1)!.kg)} ${unitWord()}, the trend through it${goalKg != null ? `, goal ${wtShortU(goalKg)}` : ''}`}>
      {#each chart.grid as g}
        <line x1={L} x2={W - R} y1={g.y} y2={g.y} class="wl-grid" />
        <text x={L - 6} y={g.y + 3.5} text-anchor="end" class="wl-axis">{g.label}</text>
      {/each}
      {#if chart.goal != null}
        <line x1={L} x2={W - R} y1={chart.goal} y2={chart.goal} class="wl-goal" />
        <text x={W - R} y={chart.goal - 5} text-anchor="end" class="wl-goal-t">goal {wtShort(goalKg)}</text>
      {/if}
      {#each chart.dots as d}<circle cx={d.x} cy={d.y} r="1.9" class="wl-dot" />{/each}
      <path d={chart.line} class="wl-trend" />
      {#if chart.end}<circle cx={chart.end.x} cy={chart.end.y} r="3.6" class="wl-end" />{/if}
      {#each chart.xs as t}<text x={t.x} y={H - 6} text-anchor={t.a} class="wl-axis">{t.label}</text>{/each}
    </svg>
    <div class="wl-key"><span class="wl-k-dot"></span>each morning <span class="wl-k-line"></span>the trend, {changeWord()}</div>
  {:else}
    <div class="wl-empty">Your line starts with two mornings on the scale.</div>
  {/if}

  <!-- The odds and the pace are in the hero above (2026-10-31): said once. -->

  {#if along}
    <div class="wl-bar" role="img" aria-label={`${Math.round(along.pct * 100)}% of the way to the goal`}>
      <div class="wl-bar-fill" style="width:{(along.pct * 100).toFixed(1)}%"></div>
    </div>
    <div class="flex jb wl-bar-t">
      <span>{wtShortU($body.firstKg)} start</span>
      <span>{dwt(along.done)} of {dwt(along.total)}</span>
      <span>{wtShortU(goalKg)} goal</span>
    </div>
  {/if}
</div>

<style>
  .wl svg{display:block;margin-top:10px;overflow:visible}
  .wl .tab{padding:3px 10px;font-size:0.6875rem}
  .wl-grid{stroke:var(--border);stroke-width:1}
  .wl-axis{fill:var(--muted);font-size:0.6875rem;font-family:var(--font-label)}
  .wl-goal{stroke:var(--led-good);stroke-width:1.2;stroke-dasharray:4 4}
  .wl-goal-t{fill:var(--led-good);font-size:0.6875rem;font-weight:700;font-family:var(--font-label)}
  .wl-dot{fill:var(--muted);opacity:.55}
  .wl-trend{fill:none;stroke:var(--amber);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
  .wl-end{fill:var(--amber);stroke:var(--bg2);stroke-width:2}
  .wl-key{display:flex;align-items:center;gap:6px;font-size:0.6875rem;color:var(--muted);margin-top:4px}
  .wl-k-dot{width:6px;height:6px;border-radius:50%;background:var(--muted);opacity:.7}
  .wl-k-line{width:14px;height:2.5px;border-radius:2px;background:var(--amber);margin-left:8px}
  .wl-empty{font-size:0.8125rem;color:var(--muted);text-align:center;padding:26px 0 18px}
  .wl-bar{height:6px;border-radius:3px;background:var(--bg3);margin-top:12px;overflow:hidden}
  .wl-bar-fill{height:100%;background:var(--amber);border-radius:3px}
  .wl-bar-t{font-size:0.6875rem;color:var(--muted);margin-top:4px}
</style>
