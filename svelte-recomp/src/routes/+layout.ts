import { restoreRememberedUnit } from '$lib/stores/units';

export const prerender = true;
export const ssr = false;

// The person's unit before the first frame, so pounds never flash as kilograms
// (units.ts stays pure; the device's memory of it lives in stores/units.ts).
restoreRememberedUnit();
