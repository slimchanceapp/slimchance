<script lang="ts">
  import { page } from '$app/stores';
  import { base } from '$app/paths';
  import { haptic } from '$lib/haptics';

  const tabs = [
    { id: '/', label: 'Today', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
    { id: '/recipes', label: 'Food', icon: 'M12 6V2m0 4a4 4 0 100 8 4 4 0 000-8zm0 0V2m0 0l-2 2m2-2l2 2M3 12h4m10 0h4' },
    { id: '/workouts', label: 'Train', icon: 'M7 11V7a4 4 0 018 0v4M3 15h18M5 15v4a1 1 0 001 1h12a1 1 0 001-1v-4' },
    // Progress answers "is this working — fat or muscle?", the one question the
    // other tabs only collect inputs for. Alarms lost its tab (it's reminders,
    // not a daily destination) and now lives on the top bar, reachable anywhere.
    { id: '/progress', label: 'Progress', icon: 'M3 17l6-6 4 4 8-8M21 7v6h-6' },
  ];

  const currentPath = $derived($page.url.pathname);

  // The scroll container is <main id="pages">, not the window, so tapping a tab
  // (even the one you're already on) otherwise leaves you mid-page. Snap to top,
  // and give a light tick so switching tabs feels like a physical detent.
  function toTop(tabId: string) {
    haptic(currentPath === base + tabId ? 'tap' : 'select');
    document.getElementById('pages')?.scrollTo({ top: 0, behavior: 'smooth' });
  }
</script>

<nav id="bottom-nav">
  {#each tabs as tab}
    <a href={base + tab.id} data-tap={'tab-' + tab.label.toLowerCase()} class="nb" class:active={currentPath === base + tab.id} onclick={() => toTop(tab.id)}>
      <svg viewBox="0 0 24 24"><path d={tab.icon}/></svg>
      {tab.label}
    </a>
  {/each}
</nav>

<style>
  #bottom-nav{background:var(--bg);border-top:1px solid var(--border);display:flex;align-items:flex-start;height:calc(var(--nav-h) + var(--sb));padding:0 6px var(--sb);flex-shrink:0;z-index:50}
  .nb{flex:1;height:var(--nav-h);border:none;background:none;color:var(--muted);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-family:var(--font-label);font-size:0.8125rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;transition:color .2s var(--ease),transform .2s var(--ease);text-decoration:none;position:relative}
  .nb:active{transform:scale(.92)}
  .nb svg{width:21px;height:21px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .nb.active{color:var(--text)}
  /* The current tab is a lit segment on the top edge, not a glow. */
  .nb.active::before{content:'';position:absolute;top:-1px;width:30px;height:3px;border-radius:0 0 2px 2px;background:var(--amber)}
</style>
