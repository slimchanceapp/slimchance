<script lang="ts">
  // Generic small line+area chart for any {date, value} series. Extracted
  // from the Track page's weight chart so it can be reused for per-exercise
  // progress (top-set weight over time) without duplicating the SVG math.
  //
  // Interactive: tap/drag anywhere on the chart (works with touch) to read
  // the exact value+date of the nearest point in a readout above the graph.
  // Defaults to showing the latest point so numbers are visible at a glance.
  let { data = [], color = 'var(--amber)', height = 110, unit = '' }: {
    data?: Array<{ date: string; value: number }>;
    color?: string;
    height?: number;
    unit?: string;
  } = $props();

  const pad = { t: 10, r: 10, b: 20, l: 10 };
  const chartW = 300;
  const chartH = $derived(height);
  const plotW = chartW - pad.l - pad.r;
  const plotH = $derived(chartH - pad.t - pad.b);

  let svgEl = $state<SVGSVGElement | null>(null);
  let activeIdx = $state<number | null>(null);

  function scaled(pts: Array<{ date: string; value: number }>) {
    const mn = Math.min(...pts.map((p) => p.value)) - 1;
    const mx = Math.max(...pts.map((p) => p.value)) + 1;
    const rng = mx - mn || 1;
    return pts.map((p, i) => ({
      x: pad.l + (i / (pts.length - 1 || 1)) * plotW,
      y: pad.t + (1 - (p.value - mn) / rng) * plotH,
      ...p,
    }));
  }

  const points = $derived(data.length >= 2 ? scaled(data) : []);

  const linePath = $derived.by(() => {
    if (points.length < 2) return '';
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  });

  const areaPath = $derived.by(() => {
    if (points.length < 2) return '';
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    return `${line}L${pad.l + plotW},${pad.t + plotH}L${pad.l},${pad.t + plotH}Z`;
  });

  const labels = $derived.by(() => {
    if (points.length < 2) return [];
    const step = Math.max(1, Math.floor(points.length / 4));
    return points.filter((_, i) => i % step === 0 || i === points.length - 1);
  });

  // The point currently shown in the readout: the tapped one, or the latest.
  const active = $derived(points.length ? points[activeIdx ?? points.length - 1] : null);

  function fmtVal(v: number): string {
    return Number.isInteger(v) ? v.toLocaleString() : (Math.round(v * 10) / 10).toLocaleString();
  }
  function fmtDate(d: string): string {
    const parts = d.split('-');
    if (parts.length < 3) return d;
    const dt = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function pick(clientX: number) {
    if (!svgEl || points.length < 2) return;
    const rect = svgEl.getBoundingClientRect();
    const xInView = ((clientX - rect.left) / rect.width) * chartW;
    const frac = (xInView - pad.l) / plotW;
    const idx = Math.max(0, Math.min(points.length - 1, Math.round(frac * (points.length - 1))));
    activeIdx = idx;
  }

  function onDown(e: PointerEvent) {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pick(e.clientX);
  }
  function onMove(e: PointerEvent) {
    if (e.pressure === 0 && e.buttons === 0) return; // only while pressed/dragging
    pick(e.clientX);
  }
</script>

{#if data.length < 2}
  <div class="mc-empty">Log at least 2 sessions to see a trend chart.</div>
{:else}
  <div class="mc-wrap">
    <div class="mc-readout" style="color:{color}">
      <span class="mc-val">{active ? fmtVal(active.value) : '--'}{unit}</span>
      <span class="mc-date">{active ? fmtDate(active.date) : ''}</span>
    </div>
    <svg
      bind:this={svgEl}
      viewBox="0 0 {chartW} {chartH}" width="100%" height={chartH}
      style="touch-action:pan-y"
      data-own-swipe
      onpointerdown={onDown}
      onpointermove={onMove}
      role="img" aria-label="Trend chart — tap to read values"
    >
      <path d={areaPath} fill={color} opacity="0.15" />
      <path d={linePath} stroke={color} stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      {#each labels as lbl}
        <circle cx={lbl.x} cy={lbl.y} r="2.5" fill={color} />
        <text x={lbl.x} y={chartH - 4} font-size="8" fill="var(--muted)" text-anchor="middle">{lbl.date.slice(5)}</text>
      {/each}
      {#if active}
        <line x1={active.x} y1={pad.t} x2={active.x} y2={pad.t + plotH} stroke={color} stroke-width="1" opacity="0.4" stroke-dasharray="3 3" />
        <circle cx={active.x} cy={active.y} r="4.5" fill={color} stroke="var(--bg2)" stroke-width="1.5" />
      {/if}
    </svg>
  </div>
{/if}

<style>
  .mc-empty{font-size:0.6875rem;color:var(--muted);text-align:center;padding:16px 0}
  .mc-wrap{position:relative}
  .mc-readout{display:flex;align-items:baseline;justify-content:center;gap:8px;margin-bottom:2px}
  .mc-val{font-size:1.25rem;font-weight:800;line-height:1}
  .mc-date{font-size:0.6875rem;color:var(--muted);font-weight:600}
</style>
