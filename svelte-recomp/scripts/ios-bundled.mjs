// The iPhone app carries the app inside it (Apple guideline 4.2: not "a
// website in a wrapper"; it also opens in airplane mode). `cap sync ios`
// copies the root capacitor.config.json, which points Android at the live
// site; this takes that address out of the iPhone's copy, and checks the
// bundled app is really there. Android keeps loading the live site.
//   BUILD_TARGET=capacitor npm run build && npx cap sync ios && node scripts/ios-bundled.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const p = 'ios/App/App/capacitor.config.json';
const c = JSON.parse(readFileSync(p, 'utf8'));
delete c.server;
writeFileSync(p, JSON.stringify(c, null, '\t') + '\n');
if (!existsSync('ios/App/App/public/index.html')) {
  console.error('ios-bundled: no app in ios/App/App/public: build with BUILD_TARGET=capacitor, then cap sync ios');
  process.exit(1);
}
console.log('ios-bundled: the iPhone app carries the app inside it; no server.url');
