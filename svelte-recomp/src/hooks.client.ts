// Runs before any page: what old phone browsers lack (src/lib/polyfills.ts).
import { installPolyfills } from '$lib/polyfills';

installPolyfills(globalThis);
