<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';

  // Old Track links (bookmarks, the home screen, old notifications) were about
  // food: they open Food (the 12 Nov stranger run landed on Today instead).
  onMount(() => goto(base + '/recipes', { replaceState: true }));
</script>

<div style="padding:40px;text-align:center;color:var(--muted)">Opening Food…</div>
