import type { Card, Digits } from './cards';

/**
 * How hard a puzzle is to reason through, measured by solving it the way a
 * person would once every card's answer is known:
 *
 * 1. One clue at a time: cross out digits a position can't be according to a
 *    single card, and repeat until nothing changes. `singleRounds` counts the
 *    passes; a longer chain means each deduction unlocks the next.
 * 2. Two clues together: if that stalls, combine cards in pairs, which is
 *    much harder to do in your head. `pairRounds` counts those passes.
 * 3. Anything still open after that needs trial and error (`needsSearch`).
 *
 * `inferable` counts cards whose answer can be worked out from the other
 * cards' answers alone: only one of its answers would leave exactly one code.
 * `score` combines the solving steps into one reasoning score. Inferable
 * cards aren't counted there: they save checks, which `checks` already
 * reflects, since the simulated player relies on the same one-code promise.
 *
 * `checks` estimates how many checks a sensible player needs before only one
 * code is possible (see estimateChecks).
 */
export interface Reasoning {
  singleRounds: number;
  pairRounds: number;
  needsSearch: boolean;
  inferable: number;
  score: number;
}

export interface Analysis extends Reasoning {
  checks: number;
}

type Check = (d: Digits) => boolean;

const bitCount = (m: number) => {
  let n = 0;
  for (; m; m &= m - 1) n++;
  return n;
};

/** Every code whose digits are allowed by `domains` (bitmasks of digit values). */
function* product(domains: number[], lo: number, hi: number): Generator<number[]> {
  const code = new Array<number>(domains.length);
  function* fill(i: number): Generator<number[]> {
    if (i === domains.length) {
      yield code;
      return;
    }
    for (let v = lo; v <= hi; v++) {
      if (domains[i] & (1 << v)) {
        code[i] = v;
        yield* fill(i + 1);
      }
    }
  }
  yield* fill(0);
}

/**
 * Narrow each position to the digits that appear in some allowed code passing
 * all of `checks`. Returns whether anything changed.
 */
function narrowBy(domains: number[], checks: Check[], lo: number, hi: number): boolean {
  const seen = new Array<number>(domains.length).fill(0);
  for (const code of product(domains, lo, hi)) {
    if (checks.every((c) => c(code))) code.forEach((v, i) => (seen[i] |= 1 << v));
  }
  let changed = false;
  domains.forEach((m, i) => {
    if ((m & seen[i]) !== m) {
      domains[i] = m & seen[i];
      changed = true;
    }
  });
  return changed;
}

/** Every code of `length` digits from lo to hi. */
function allCodes(length: number, lo: number, hi: number): Digits[] {
  const full = Array.from({ length: hi - lo + 1 }, (_, i) => 1 << (lo + i)).reduce((a, b) => a | b, 0);
  // product() reuses one array per code, so copy each as it's produced.
  return Array.from(product(new Array<number>(length).fill(full), lo, hi), (c) => [...c]);
}

export function analyze(cards: Card[], length: number, lo: number, hi: number): Analysis {
  return { ...reason(cards, length, lo, hi), checks: estimateChecks(cards, allCodes(length, lo, hi)) };
}

/** The solving-steps part of the analysis, which is much cheaper than estimating checks. */
export function reason(cards: Card[], length: number, lo: number, hi: number): Reasoning {
  const checks: Check[] = cards.map((c) => (d) => c.test(c.answer, d));
  const full = Array.from({ length: hi - lo + 1 }, (_, i) => 1 << (lo + i)).reduce((a, b) => a | b, 0);
  const domains = new Array<number>(length).fill(full);
  const solved = () => domains.every((m) => bitCount(m) === 1);

  let singleRounds = 0;
  let pairRounds = 0;
  for (;;) {
    let changed = false;
    for (const c of checks) changed = narrowBy(domains, [c], lo, hi) || changed;
    if (changed) singleRounds++;
    if (solved() || changed) {
      if (solved()) break;
      continue;
    }
    // Single clues are stuck: try pairs of clues together.
    for (let a = 0; a < checks.length && !changed; a++) {
      for (let b = a + 1; b < checks.length && !changed; b++) {
        changed = narrowBy(domains, [checks[a], checks[b]], lo, hi);
      }
    }
    if (!changed) break;
    pairRounds++;
  }
  const needsSearch = !solved();

  // Cards a player could work out from the others without checking them.
  const codes = allCodes(length, lo, hi);
  let inferable = 0;
  cards.forEach((card, i) => {
    const others = codes.filter((d) => checks.every((c, j) => j === i || c(d)));
    const unique = card.options.filter((_, o) => others.filter((d) => card.test(o, d)).length === 1).length;
    if (unique === 1) inferable++;
  });

  const score = singleRounds + 3 * pairRounds + (needsSearch ? 8 : 0);
  return { singleRounds, pairRounds, needsSearch, inferable, score };
}

const CHECKS_PER_ROUND = 3;
/** Codes the simulated player considers testing each step (for speed). */
const CANDIDATE_CODES = 40;

/**
 * How many checks a sensible player needs to be sure of the code.
 *
 * The player sees the cards but not their answers. A "world" is one choice of
 * answer for every card that leaves exactly one possible code, the promise
 * every puzzle keeps. Each round the simulated player picks a code and up to
 * 3 cards, choosing each check to split the remaining worlds as evenly as
 * possible; the real answers decide which worlds survive. It stops once every
 * surviving world points to the same code.
 */
export function estimateChecks(cards: Card[], codes: Digits[]): number {
  const words = Math.ceil(codes.length / 32);
  // passBits[k][o]: bitset of codes that get answer o on card k.
  const passBits = cards.map((card) =>
    card.options.map((_, o) => {
      const bits = new Uint32Array(words);
      codes.forEach((d, n) => {
        if (card.test(o, d)) bits[n >> 5] |= 1 << (n & 31);
      });
      return bits;
    }),
  );

  // Every assignment of answers that leaves exactly one code.
  const worlds: { answers: number[]; code: number }[] = [];
  const answers: number[] = [];
  const levels = cards.map(() => new Uint32Array(words));
  const walk = (k: number, acc: Uint32Array) => {
    if (k === cards.length) {
      let found = -1;
      for (let w = 0; w < words; w++) {
        let m = acc[w];
        while (m) {
          if (found >= 0) return; // two or more codes: not a valid puzzle
          found = w * 32 + (31 - Math.clz32(m & -m));
          m &= m - 1;
        }
      }
      if (found >= 0) worlds.push({ answers: [...answers], code: found });
      return;
    }
    const next = levels[k];
    for (let o = 0; o < cards[k].options.length; o++) {
      let any = 0;
      for (let w = 0; w < words; w++) any |= next[w] = acc[w] & passBits[k][o][w];
      if (!any) continue;
      answers[k] = o;
      walk(k + 1, next);
    }
  };
  walk(0, new Uint32Array(words).fill(0xffffffff));

  const truth = cards.map((c) => c.answer);
  let alive = worlds;
  let checks = 0;
  const settled = () => alive.every((w) => w.code === alive[0].code);
  // How evenly a check splits the surviving worlds (lower is better).
  const spread = (k: number, code: Digits) => {
    const pass = alive.filter((w) => cards[k].test(w.answers[k], code)).length;
    return pass * pass + (alive.length - pass) * (alive.length - pass);
  };

  let seed = 1;
  while (!settled() && checks < 60) {
    // Pick the round's code: the one whose best single check splits worlds most evenly.
    const pool = new Set<number>();
    for (let i = 0; i < CANDIDATE_CODES; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      pool.add(i % 2 ? alive[seed % alive.length].code : seed % codes.length);
    }
    let best = { score: Infinity, code: codes[0] };
    for (const n of pool) {
      for (let k = 0; k < cards.length; k++) {
        const s = spread(k, codes[n]);
        if (s < best.score) best = { score: s, code: codes[n] };
      }
    }
    // Then use up to 3 checks with that code, each the most informative left.
    const used = new Set<number>();
    for (let i = 0; i < CHECKS_PER_ROUND && !settled(); i++) {
      let pick = -1;
      let pickScore = alive.length * alive.length;
      for (let k = 0; k < cards.length; k++) {
        if (used.has(k)) continue;
        const s = spread(k, best.code);
        if (s < pickScore) [pick, pickScore] = [k, s];
      }
      if (pick < 0) break; // nothing left that this code can tell apart
      used.add(pick);
      checks++;
      const result = cards[pick].test(truth[pick], best.code);
      alive = alive.filter((w) => cards[pick].test(w.answers[pick], best.code) === result);
    }
  }
  return checks;
}
