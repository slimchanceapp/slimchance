// The tag on the link someone arrived by (slimchance.app/?from=r-loseit-1),
// kept on this device until there is an account to count it with; events.ts
// sends it once. The first tag wins. Loaded by the app and by every page
// people land on. Keep the pattern equal to note_origin's (selfcheck holds
// them together).
try {
  var tag = new URLSearchParams(location.search).get('from');
  if (tag && /^[a-z0-9][a-z0-9-]{0,39}$/.test(tag) && !localStorage.getItem('recompos.cameFrom')) {
    localStorage.setItem('recompos.cameFrom', tag);
  }
} catch (e) { /* storage off: this visit isn't counted by tag */ }
