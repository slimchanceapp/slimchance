// Where someone shops, as Open Food Facts files it: a country code (ISO 3166
// alpha-2, as the app sends it) -> the countries_tags to search first, and a
// short label for the app's "sold in" chip. Slovakia and Czechia share one
// market (the same shops, labels in both languages).

const PAIRS: Record<string, string[]> = { SK: ['SK', 'CZ'], CZ: ['CZ', 'SK'] };
// Where Open Food Facts' English country name differs from the standard one.
const OFF_NAMES: Record<string, string> = { CZ: 'czech-republic', HK: 'hong-kong', MO: 'macau', TR: 'turkey' };
const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });

function tag(iso: string): string | null {
  if (OFF_NAMES[iso]) return `en:${OFF_NAMES[iso]}`;
  const name = names.of(iso);
  if (!name || /unknown/i.test(name)) return null;
  return 'en:' + name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
}

export function market(iso: unknown): { tags: string[]; label: string } | null {
  if (typeof iso !== 'string' || !/^[A-Z]{2}$/.test(iso)) return null;
  const codes = PAIRS[iso] ?? [iso];
  const tags = codes.map(tag);
  return tags.every(Boolean) ? { tags: tags as string[], label: codes.join('/') } : null;
}
