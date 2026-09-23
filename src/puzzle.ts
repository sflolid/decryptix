import { type Card, type Digits, cardPool } from './cards';
import { type Rng, hashString, mulberry32, shuffle } from './rng';

export const DIFFICULTIES = {
  easy: { label: 'Easy', length: 3, minCards: 4, maxCards: 5, trickyChance: 0.25 },
  medium: { label: 'Medium', length: 4, minCards: 1, maxCards: 5, trickyChance: 0.4 },
  hard: { label: 'Hard', length: 5, minCards: 1, maxCards: 6, trickyChance: 0.55 },
  veryhard: { label: 'Very hard', length: 6, minCards: 1, maxCards: 7, trickyChance: 0.65 },
} as const;
export type Difficulty = keyof typeof DIFFICULTIES;

export interface Puzzle {
  number: number;
  difficulty: Difficulty;
  secret: Digits;
  cards: Card[];
}

const SAMPLE_SIZE = 6;
/**
 * An "=" answer pins a digit or total outright, so those cards are far
 * stronger than their "<" / ">" siblings and greedy picking would favor them.
 * Keep only this share of them, so comparisons usually need combining with
 * other clues to pin anything down.
 */
const EXACT_KEEP = 0.2;
/**
 * Some card kinds narrow things down far faster than others, so an unchecked
 * greedy pick would make every puzzle out of them. Cap how many of each kind
 * a puzzle may use.
 */
const KIND_LIMITS: Record<string, number> = {
  vsValue: 2,
  pairSum: 2,
  countOf: 2,
  vsDigit: 3,
  gap: 2,
  either: 1,
};
/** Day #1 of the daily puzzle. */
const EPOCH = Date.UTC(2026, 8, 22);
export const DIGIT_MIN = 1;
export const DIGIT_MAX = 6;

/** Every possible code for a digit range, indexed as base-N numbers. */
interface Space {
  codes: Digits[];
}
const spaces = new Map<string, Space>();
function space(lo: number, hi: number, length: number): Space {
  const key = `${lo}-${hi}-${length}`;
  let s = spaces.get(key);
  if (!s) {
    const base = hi - lo + 1;
    const codes = Array.from({ length: base ** length }, (_, n) =>
      Array.from({ length }, (_, i) => lo + (Math.floor(n / base ** (length - 1 - i)) % base)),
    );
    s = { codes };
    spaces.set(key, s);
  }
  return s;
}

const passCache = new WeakMap<Card, Uint8Array>();
/** 1 for every code that passes the card's hidden rule, 0 otherwise. */
function passesOf(sp: Space, card: Card): Uint8Array {
  let c = passCache.get(card);
  if (!c) {
    c = Uint8Array.from(sp.codes, (d) => (card.test(card.answer, d) ? 1 : 0));
    passCache.set(card, c);
  }
  return c;
}

/** Codes that pass every card's hidden rule. */
function matching(sp: Space, cards: Card[], among?: number[]): number[] {
  const passes = cards.map((c) => passesOf(sp, c));
  const out: number[] = [];
  const test = (n: number) => passes.every((p) => p[n] === 1) && out.push(n);
  if (among) among.forEach(test);
  else for (let n = 0; n < sp.codes.length; n++) test(n);
  return out;
}

/**
 * Candidates that pass one card's hidden rule. Tests only the given codes
 * rather than caching the whole space, since most sampled cards are never used.
 */
const narrow = (sp: Space, card: Card, candidates: number[]) =>
  candidates.filter((n) => card.test(card.answer, sp.codes[n]));

/**
 * Greedily pick cards (best of a small random sample each round, for variety)
 * until the secret is the only code passing every hidden rule, then drop any
 * card that turns out to be redundant. With probability `trickyChance` it
 * starts from a tricky card, so harder cards turn up often but not always.
 */
export function buildCards(
  secret: Digits,
  rng: Rng,
  maxCards: number,
  minCards = 1,
  trickyChance = 0,
  lo = DIGIT_MIN,
  hi = DIGIT_MAX,
): Card[] | null {
  const sp = space(lo, hi, secret.length);
  const pool = shuffle(rng, cardPool(rng, lo, hi, secret.length));
  for (const card of pool) {
    // The secret gets one answer per group; the card checks one of them.
    const passing = card.options.map((_, j) => j).filter((j) => card.test(j, secret));
    card.answer = passing[Math.floor(rng() * passing.length)];
  }
  for (let i = pool.length - 1; i >= 0; i--) {
    if (pool[i].exact[pool[i].answer] && rng() >= EXACT_KEEP) pool.splice(i, 1);
  }
  let candidates = Array.from({ length: sp.codes.length }, (_, n) => n);
  const chosen: Card[] = [];

  // Tricky cards narrow things down so well that greedy picking would put one
  // in nearly every puzzle; instead a puzzle gets them only `trickyChance` of
  // the time, starting from one.
  if (rng() < trickyChance) {
    const idx = pool.findIndex((c) => c.tricky && narrow(sp, c, candidates).length < candidates.length);
    if (idx >= 0) {
      const [first] = pool.splice(idx, 1);
      chosen.push(first);
      candidates = narrow(sp, first, candidates);
    }
  } else {
    for (let i = pool.length - 1; i >= 0; i--) if (pool[i].tricky) pool.splice(i, 1);
  }

  while (candidates.length > 1 && pool.length > 0) {
    let best: { idx: number; left: number[] } | null = null;
    for (let t = 0; t < SAMPLE_SIZE && t < pool.length; t++) {
      const idx = Math.floor(rng() * pool.length);
      const left = narrow(sp, pool[idx], candidates);
      if (left.length < candidates.length && (!best || left.length < best.left.length)) best = { idx, left };
    }
    if (!best) {
      pool.splice(Math.floor(rng() * pool.length), 1);
      continue;
    }
    const pick = pool.splice(best.idx, 1)[0];
    chosen.push(pick);
    candidates = best.left;

    const limit = KIND_LIMITS[pick.kind];
    if (limit !== undefined && chosen.filter((c) => c.kind === pick.kind).length >= limit) {
      for (let i = pool.length - 1; i >= 0; i--) if (pool[i].kind === pick.kind) pool.splice(i, 1);
    }
  }

  if (candidates.length !== 1) return null;

  for (let i = chosen.length - 1; i >= 0; i--) {
    const without = chosen.filter((_, j) => j !== i);
    if (matching(sp, without).length === 1) chosen.splice(i, 1);
  }

  return chosen.length >= minCards && chosen.length <= maxCards ? shuffle(rng, chosen) : null;
}

export function generatePuzzle(seed: string, difficulty: Difficulty = 'hard', number = 0): Puzzle {
  const { length, minCards, maxCards, trickyChance } = DIFFICULTIES[difficulty];
  const rng = mulberry32(hashString(seed));
  for (;;) {
    const secret = Array.from({ length }, () => DIGIT_MIN + Math.floor(rng() * (DIGIT_MAX - DIGIT_MIN + 1)));
    const cards = buildCards(secret, rng, maxCards, minCards, trickyChance);
    if (cards) return { number, difficulty, secret, cards };
  }
}

export function todayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function puzzleNumber(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - EPOCH) / 86400000) + 1;
}

export function dailyPuzzle(difficulty: Difficulty, key = todayKey()): Puzzle {
  return generatePuzzle(`decrypt:${key}:${difficulty}`, difficulty, puzzleNumber(key));
}

/** Every code consistent with the puzzle's hidden answers (tests check it's just the secret). */
export function solutions(p: Puzzle): Digits[] {
  const sp = space(DIGIT_MIN, DIGIT_MAX, p.secret.length);
  return matching(sp, p.cards).map((n) => sp.codes[n]);
}
