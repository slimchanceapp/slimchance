<script lang="ts">
  // Camera barcode reader. It only READS the code; the food logger looks it up.
  //
  // Why scans failed: the old version trusted `'BarcodeDetector' in window`. In
  // the Android WebView that can be true while the detector has no backend —
  // getSupportedFormats() comes back empty and detect() finds nothing, forever.
  // It also streamed the camera at its default 640×480, too coarse for a small
  // EAN on a yogurt cup. Now: the native detector only if it really reads EAN,
  // otherwise ZXing compiled to WebAssembly (works in every browser and the
  // WebView, served from our own origin); a 1080p stream with continuous focus
  // and a torch button; a checksum on every read and two matching reads in a
  // row before a code counts; and the number pad is always one tap away.
  import { onMount, onDestroy } from 'svelte';
  import { validGtin } from '$lib/nutrition';
  import { haptic } from '$lib/haptics';

  let { onCode, onClose }: { onCode: (code: string) => void; onClose: () => void } = $props();

  let videoEl: HTMLVideoElement | undefined = $state();
  let status = $state('Starting camera…');
  let manual = $state('');
  let typing = $state(false);
  let torchOn = $state(false);
  let torchAvailable = $state(false);
  let stream: MediaStream | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

  async function detector(): Promise<{ detect: (s: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> }> {
    const Native = (globalThis as any).BarcodeDetector;
    if (Native?.getSupportedFormats) {
      try {
        if ((await Native.getSupportedFormats()).includes('ean_13')) return new Native({ formats: FORMATS });
      } catch { /* fall through to ZXing */ }
    }
    const [{ BarcodeDetector, prepareZXingModule }, wasm] = await Promise.all([
      import('barcode-detector/ponyfill'),
      import('zxing-wasm/reader/zxing_reader.wasm?url'),
    ]);
    prepareZXingModule({
      overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasm.default : prefix + path) },
    });
    return new BarcodeDetector({ formats: FORMATS as any });
  }

  onMount(async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      if (stopped) return stopStream();
      const track = stream.getVideoTracks()[0];
      const caps: any = track.getCapabilities?.() ?? {};
      if (caps.focusMode?.includes?.('continuous')) {
        track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] }).catch(() => {});
      }
      torchAvailable = !!caps.torch;
      if (videoEl) { videoEl.srcObject = stream; await videoEl.play(); }
      status = 'Point at the barcode';
      const d = await detector();
      let last = '';
      const tick = async () => {
        if (stopped || !videoEl) return;
        try {
          if (videoEl.readyState >= 2) {
            const code = (await d.detect(videoEl)).map((r) => r.rawValue).find(validGtin);
            // Two identical reads in a row: one glancing frame can't log the wrong food.
            if (code && code === last) { haptic('success'); finish(code); return; }
            last = code ?? '';
          }
        } catch { /* a frame that failed to decode — keep going */ }
        timer = setTimeout(tick, 110);
      };
      tick();
    } catch (e: any) {
      typing = true;
      status = e?.name === 'NotAllowedError'
        ? 'Camera blocked — allow it in Settings → Apps → Slim Chance → Permissions, or type the number.'
        : 'No camera available here — type the number under the barcode.';
    }
  });

  function stopStream() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  function finish(code: string) {
    stopped = true;
    clearTimeout(timer);
    stopStream();
    onCode(code);
  }

  function submitManual() {
    const code = manual.replace(/\D/g, '');
    if (!validGtin(code)) { status = `${code || 'That'} isn't a valid barcode — check the digits.`; return; }
    finish(code);
  }

  async function toggleTorch() {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    torchOn = !torchOn;
    try { await track.applyConstraints({ advanced: [{ torch: torchOn } as any] }); } catch { torchOn = false; }
  }

  function close() {
    stopped = true;
    clearTimeout(timer);
    stopStream();
    onClose();
  }

  onDestroy(() => { stopped = true; clearTimeout(timer); stopStream(); });
</script>

<div class="scan" role="dialog" aria-label="Scan a barcode">
  <div class="scan-view">
    {#if !typing}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={videoEl} muted playsinline class="scan-video"></video>
      <div class="scan-reticle" aria-hidden="true"></div>
    {/if}
    <button class="scan-x" onclick={close} aria-label="Close scanner">×</button>
  </div>
  <div class="scan-foot">
    <div class="scan-status" aria-live="polite">{status}</div>
    {#if typing}
      <form class="scan-manual" onsubmit={(e) => { e.preventDefault(); submitManual(); }}>
        <!-- svelte-ignore a11y_autofocus -->
        <input type="text" inputmode="numeric" autocomplete="off" placeholder="e.g. 8585002503541" bind:value={manual} autofocus>
        <button class="btn bp" type="submit" disabled={!manual.trim()}>Look up</button>
      </form>
    {:else}
      <div class="scan-actions">
        {#if torchAvailable}<button class="btn bg_ bsm" onclick={toggleTorch}>{torchOn ? 'Light off' : 'Light on'}</button>{/if}
        <button class="btn bg_ bsm" onclick={() => { typing = true; status = 'Type the number under the barcode'; }}>Type the number</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .scan{position:fixed;inset:0;z-index:260;background:#000;display:flex;flex-direction:column}
  .scan-view{position:relative;flex:1;overflow:hidden;display:grid;place-items:center}
  .scan-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .scan-reticle{position:relative;width:min(78vw,340px);height:150px;border-radius:14px;
    box-shadow:0 0 0 100vmax rgba(0,0,0,.45);border:2px solid var(--led-good, #fff)}
  .scan-reticle::after{content:'';position:absolute;left:8%;right:8%;top:50%;height:2px;background:var(--led-bad,#ff3b47);
    box-shadow:0 0 12px var(--led-bad,#ff3b47);animation:scanline 1.6s ease-in-out infinite alternate}
  @keyframes scanline{from{transform:translateY(-55px)}to{transform:translateY(55px)}}
  @media (prefers-reduced-motion:reduce){.scan-reticle::after{animation:none}}
  .scan-x{position:absolute;top:calc(var(--st) + 12px);right:12px;width:46px;height:46px;border-radius:50%;
    background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.3);color:#fff;font-size:1.625rem;cursor:pointer}
  .scan-foot{padding:14px 16px calc(18px + var(--sb));background:var(--bg);display:flex;flex-direction:column;gap:10px}
  .scan-status{font-size:0.875rem;color:var(--text);text-align:center}
  .scan-actions{display:flex;gap:8px;justify-content:center}
  .scan-manual{display:flex;gap:8px}
  .scan-manual input{flex:1}
</style>
