// Retrieval for the coach (book chapter 8): the passages of our own guides and
// FAQ nearest a question by meaning. knowledge.json holds each passage with its
// embedding (scripts/build-knowledge.mjs); the question is embedded with the
// same model, and nearness is the cosine of the angle between the two lists of
// numbers. Pure: no network here, so Node can test it and Deno can serve it.

export interface Passage { id: string; title: string; url: string; text: string; v: number[] }

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** The `k` passages nearest `q`, best first, each with its score. Below
 *  `floor` a passage isn't related enough to cite, so it's left out. */
export function nearest(q: number[], passages: Passage[], k = 3, floor = 0.5): Array<Omit<Passage, 'v'> & { score: number }> {
  return passages
    .map(({ v, ...p }) => ({ ...p, score: cosine(q, v) }))
    .filter((p) => p.score >= floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
