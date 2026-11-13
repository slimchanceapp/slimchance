// Is this sign-up one of our own robots? (2026-11-13). The nightly phone tests,
// the Safari-engine proof and audit scripts start trials on the live site; a
// run cancelled before its delete step left them behind, counted as strangers
// (68 "people" in 30 days, most of them ours). A robot is marked at sign-up and
// every count leaves it out. Pure: the caller passes what the browser says.

export interface Seen {
  /** navigator.webdriver: true under Playwright, Selenium and WebDriver. */
  webdriver: boolean;
  userAgent: string;
  /** Running in the iPhone shell (src/lib/platform.ts). */
  iosShell: boolean;
  /** The link tag this device arrived with (static/from.js). */
  cameFrom: string | null;
}

export function isAutomated(s: Seen): boolean {
  return s.webdriver
    || /\bsdk_gphone|Android SDK built for|\bEmulator\b/.test(s.userAgent)
    // ponytail: before the App Store listing only our own tests run the iPhone
    // shell; drop this line the day it's listed.
    || s.iosShell
    || s.cameFrom === 'test';
}
