import type { Idea } from "./types";

const STOP_WORDS = new Set(
  "the and for with that this you your can could would should please have has want add make let allow use using from into when what where about more than there their also any all not but are was were will just need like get".split(" ")
);

export function tokenizeText(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter(
    (w) => w.length >= 3 && !STOP_WORDS.has(w)
  );
}

export function sameWord(a: string, b: string): boolean {
  return a.slice(0, 5) === b.slice(0, 5) || b.startsWith(a) || a.startsWith(b);
}

export function countWords(text: string): number {
  return (text.trim().match(/\S+/g) || []).length;
}

export function findSimilarIdeas(text: string, product: string, ideas: Idea[]): Idea[] {
  if (countWords(text) < 3) return [];
  const queryTokens = tokenizeText(text);
  if (!queryTokens.length) return [];

  const candidates: { idea: Idea; score: number }[] = [];

  for (const idea of ideas) {
    if (idea.product !== product) continue;
    const ideaTokens = tokenizeText(idea.text);
    if (!ideaTokens.length) continue;

    let score = 0;
    for (const q of queryTokens) {
      if (ideaTokens.some((t) => sameWord(q, t))) {
        score++;
      }
    }

    if (score > 0) {
      candidates.push({ idea, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score || (b.idea.votes ?? 0) - (a.idea.votes ?? 0));
  return candidates.slice(0, 3).map((c) => c.idea);
}
