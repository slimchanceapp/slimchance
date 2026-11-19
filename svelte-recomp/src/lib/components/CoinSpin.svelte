<script lang="ts">
  // The coin, tossed: heads and tails, flipping as it goes up and comes down.
  // What the app shows while a tab takes a moment. The boot screen in src/app.html draws the same one before any of
  // this code has arrived, and its keyframes live there, global, so the two
  // are one coin (selfcheck holds the drawings equal).
  let { size = 56 }: { size?: number } = $props();
</script>

<svg class="cspin" viewBox="0 0 72 76" width={size} height={Math.round((size * 76) / 72)} aria-hidden="true"><g class="cs-toss"><g class="cs-edge"><rect x="9" y="32.5" width="54" height="9" rx="4.5" fill="currentColor" opacity=".6"/><path d="M13.0 32.5v9M16.3 32.5v9M19.6 32.5v9M22.9 32.5v9M26.2 32.5v9M29.5 32.5v9M32.8 32.5v9M36.1 32.5v9M39.4 32.5v9M42.7 32.5v9M46.0 32.5v9M49.3 32.5v9M52.6 32.5v9M55.9 32.5v9M59.2 32.5v9" stroke="#000" stroke-opacity=".32" stroke-width="1.35"/></g><g class="cs-face"><circle cx="36" cy="37" r="27" fill="currentColor"/><circle cx="36" cy="37" r="22.6" fill="none" stroke="#000" stroke-opacity=".28" stroke-width="2.1"/><g class="cs-heads"><g transform="translate(36 37) scale(2.35) translate(-12 -12)"><path d="M14.25 8.1A2.6 2.6 0 1 0 12 12a2.6 2.6 0 1 1-2.25 3.9" fill="none" stroke="#000" stroke-opacity=".34" stroke-width="1.5" stroke-linecap="round"/></g></g><g class="cs-tails"><circle cx="36" cy="37" r="27" fill="#000" opacity=".14"/><g transform="translate(36 37) scale(2.35) translate(-12 -12)"><g transform="translate(0 24) scale(1 -1)"><path d="M9.3 8.5L10.7 7.4V16.6M14.4 7.4A2 4.6 0 1 1 14.4 16.6A2 4.6 0 1 1 14.4 7.4" fill="none" stroke="#000" stroke-opacity=".34" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></g></g></g></g></g><ellipse class="cs-floor" cx="36" cy="71" rx="17" ry="2.2" fill="currentColor"/></svg>
