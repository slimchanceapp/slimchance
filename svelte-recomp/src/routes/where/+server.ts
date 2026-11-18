// The visitor's country, as Vercel saw the request arrive (ISO 3166 alpha-2),
// so food search can put what's sold there first (src/lib/nutrition/foodSources.ts
// myCountry). Nothing is stored or logged.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const prerender = false;

export const GET: RequestHandler = ({ request }) => {
  const country = request.headers.get('x-vercel-ip-country');
  return json({ country: /^[A-Z]{2}$/.test(country ?? '') ? country : null }, { headers: { 'cache-control': 'private, no-store' } });
};
