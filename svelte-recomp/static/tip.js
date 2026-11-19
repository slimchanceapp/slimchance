// The tip link on the public pages, in a browser only. Google Play and Apple
// require their own payment systems for tips to an app's maker, and the apps
// open these pages too, so inside them the line stays hidden. One place for the
// address and the words (selfcheck holds every page to it).
(function () {
  var c = window.Capacitor;
  if (c && c.isNativePlatform && c.isNativePlatform()) return;
  var p = document.getElementById('tip');
  if (!p) return;
  p.innerHTML = 'Slim Chance is free. If it helped you, <a href="https://ko-fi.com/yourslimchance">buy me a coffee</a>.';
  p.hidden = false;
})();
