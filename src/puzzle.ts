import { type Rng, hashString, mulberry32, shuffle } from './rng';
import { type Digits, type Rule, rulesTrueFor } from './rules';

export interface Puzzle {
  number: number;
  secret: Digits;
  rules: Rule[];
}

const MAX_RULES = 8;
const SAMPLE_SIZE = 6;
/**
 * Arithmetic rules are much stronger filters than the rest, so an unchecked
 * greedy pick would make every puzzle "X and Y add to N". Cap them by kind
 * (the letters at the start of the rule id).
 */
const KIND_LIMITS: Record<string, number> = { sum: 2, diff: 1, sumAll: 1 };
const kindOf = (r: Rule) => r.id.match(/^[a-zA-Z]+/)![0];
/** Day #1 of the daily puzzle. */
const EPOCH = Date.UTC(2026, 8, 22);

let allCodes: Digits[] | null = null;
function everyCode(): Digits[] {
  if (!allCodes) {
    allCodes = [];
    for (let n = 0; n < 100000; n++) {
      allCodes.push(String(n).padStart(5, '0').split('').map(Number));
    }
  }
  return allCodes;
}

const matchesAll = (rules: Rule[]) => (d: Digits) => rules.every((r) => r.test(d));

/**
 * Greedily pick rules (from a small random sample each round, for variety)
 * until exactly one code satisfies them all, then drop any rule that turns
 * out to be redundant. Returns null if it couldn't get a unique answer
 * within MAX_RULES.
 */
function tryBuild(secret: Digits, rng: Rng): Rule[] | null {
  const pool = shuffle(rng, rulesTrueFor(secret, rng));
  let candidates = everyCode();
  const chosen: Rule[] = [];

  while (candidates.length > 1 && pool.length > 0) {
    let best: { idx: number; left: Digits[] } | null = null;
    for (let s = 0; s < SAMPLE_SIZE && s < pool.length; s++) {
      const idx = Math.floor(rng() * pool.length);
      const left = candidates.filter(pool[idx].test);
      if (left.length < candidates.length && (!best || left.length < best.left.length)) {
        best = { idx, left };
      }
    }
    if (!best) {
      // Sampled only useless rules; drop one and keep going.
      pool.splice(Math.floor(rng() * pool.length), 1);
      continue;
    }
    const pick = pool.splice(best.idx, 1)[0];
    chosen.push(pick);
    candidates = best.left;

    const kind = kindOf(pick);
    if (kind in KIND_LIMITS && chosen.filter((r) => kindOf(r) === kind).length >= KIND_LIMITS[kind]) {
      for (let i = pool.length - 1; i >= 0; i--) if (kindOf(pool[i]) === kind) pool.splice(i, 1);
    }
  }

  if (candidates.length !== 1) return null;

  for (let i = chosen.length - 1; i >= 0; i--) {
    const without = chosen.filter((_, j) => j !== i);
    if (everyCode().filter(matchesAll(without)).length === 1) chosen.splice(i, 1);
  }

  return chosen.length <= MAX_RULES ? shuffle(rng, chosen) : null;
}

export function generatePuzzle(seed: string, number = 0): Puzzle {
  const rng = mulberry32(hashString(seed));
  for (;;) {
    const secret = Array.from({ length: 5 }, () => Math.floor(rng() * 10));
    const rules = tryBuild(secret, rng);
    if (rules) return { number, secret, rules };
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

export function dailyPuzzle(key = todayKey()): Puzzle {
  return generatePuzzle(`decrypt:${key}`, puzzleNumber(key));
}

/** Codes that satisfy every rule (used by tests to check uniqueness). */
export function solutions(rules: Rule[]): Digits[] {
  return everyCode().filter(matchesAll(rules));
}
