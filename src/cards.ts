import { type Rng, randInt } from './rng';

export type Digits = readonly number[];

/**
 * A rule card asks a question about a code ("The 3rd digit is… even / odd")
 * and lists every possible answer. Answers come in groups of `groupSize`;
 * within a group they never overlap, so every code gets exactly one answer
 * per group. Most cards have a single group. The card secretly checks one of
 * the secret's answers, `answer`, and checking a code reveals only whether
 * the code gets that same answer (✓) or not (✗).
 *
 * A card with two groups (e.g. the 1st digit against the 2nd, or against the
 * 3rd) checks just one of them, and the player has to work out which.
 */
export interface Card {
  id: string;
  kind: string;
  title: string;
  options: string[];
  /** Answers per group; equal to options.length for single-group cards. */
  groupSize: number;
  /** Whether a code gets answer `option`. */
  test: (option: number, d: Digits) => boolean;
  /** Harder cards, flagged in the UI and used sparingly by the generator. */
  tricky: boolean;
  /** Short explanation shown on tricky cards; may contain `{n}` positions. */
  hint?: string;
  /** Answers that pin a value exactly ("= 3", "= ▲ 2nd"); the generator uses them sparingly. */
  exact: boolean[];
  /** Index of the answer being checked; set by the puzzle generator. */
  answer: number;
}

/** One group of non-overlapping answers: `classify` says which one a code gets. */
interface Group {
  options: string[];
  classify: (d: Digits) => number;
}

/**
 * Ordinal name and marker shape for each digit position. The first five gain
 * an edge per position (0 = circle) so their order is easy to read at a
 * glance; the 6th is a five-point star, since a heptagon reads as a circle
 * at marker size.
 */
export const POSITIONS: { name: string; sides: number; star?: boolean }[] = [
  { name: '1st', sides: 0 },
  { name: '2nd', sides: 3 },
  { name: '3rd', sides: 4 },
  { name: '4th', sides: 5 },
  { name: '5th', sides: 6 },
  { name: '6th', sides: 5, star: true },
];

/**
 * Card text refers to digit positions as `{0}`…`{5}` so the UI can render
 * each one with its position's symbol. Split text into literal strings and
 * position numbers.
 */
export function textParts(text: string): (string | number)[] {
  return text.split(/\{(\d)\}/).map((part, i) => (i % 2 ? Number(part) : part));
}

const POS = POSITIONS.map((_, i) => `{${i}}`);
const sum = (d: Digits) => d.reduce((a, b) => a + b, 0);
const cmp = (a: number, b: number) => (a < b ? 0 : a === b ? 1 : 2);

/** "< x", "= x", "> x": the three outcomes of comparing against x, in cmp() order. */
const compared = (x: string) => [`< ${x}`, `= ${x}`, `> ${x}`];

/**
 * Every card the generator may pick from, with random parameters filled in.
 * Each card lists every outcome individually (no "two or more" style
 * groupings), and exactly one outcome is true for any code.
 */
export function cardPool(rng: Rng, lo = 0, hi = 9, length = 5): Card[] {
  const mid = (lo + hi) / 2;
  const cards: Card[] = [];
  const addGroups = (kind: string, id: string, title: string, groups: Group[], extra: Partial<Card> = {}) => {
    const groupSize = groups[0].options.length;
    cards.push({
      id: `${kind}:${id}`,
      kind,
      title,
      options: groups.flatMap((g) => g.options),
      groupSize,
      // compared() writes its equality answer as "= x".
      exact: groups.flatMap((g) => g.options.map((o) => o.startsWith('= '))),
      test: (j, d) => groups[Math.floor(j / groupSize)].classify(d) === j % groupSize,
      tricky: false,
      answer: -1,
      ...extra,
    });
  };
  const add = (kind: string, id: string, title: string, options: string[], classify: Group['classify'], extra?: Partial<Card>) =>
    addGroups(kind, id, title, [{ options, classify }], extra);
  const upTo = (n: number, from = 0) => Array.from({ length: n - from + 1 }, (_, i) => String(from + i));

  for (let i = 0; i < length; i++) {
    const p = POS[i];
    add('parity', `${i}`, `The ${p} digit is…`, ['even', 'odd'], (d) => d[i] % 2);

    const k = randInt(rng, lo + 1, hi - 1);
    add('vsValue', `${i}`, `The ${p} digit is…`, compared(String(k)), (d) => cmp(d[i], k));

    for (let j = i + 1; j < length; j++) {
      const q = POS[j];
      add('vsDigit', `${i}${j}`, `The ${p} digit is…`, compared(q), (d) => cmp(d[i], d[j]));
      // Tricky: every possible gap (0 to hi - lo), but not which digit is bigger.
      add('gap', `${i}${j}`, `How far apart are the ${p} and ${q} digits?`, upTo(hi - lo), (d) => Math.abs(d[i] - d[j]), {
        tricky: true,
        hint: 'Tricky: says how far apart, not which digit is bigger.',
      });

      const s = randInt(rng, Math.round(2 * mid) - 2, Math.round(2 * mid) + 2);
      add('pairSum', `${i}${j}`, `The ${p} + ${q} digits add up to…`, compared(String(s)), (d) => cmp(d[i] + d[j], s));
    }
  }

  // Tricky: one digit against either of two others, checking only one comparison.
  for (let i = 0; i < length; i++) {
    const others = [...Array(length).keys()].filter((x) => x !== i);
    for (let a = 0; a < others.length; a++) {
      for (let b = a + 1; b < others.length; b++) {
        const [j, k] = [others[a], others[b]];
        addGroups(
          'either',
          `${i}${j}${k}`,
          `The ${POS[i]} digit is…`,
          [
            { options: compared(POS[j]), classify: (d) => cmp(d[i], d[j]) },
            { options: compared(POS[k]), classify: (d) => cmp(d[i], d[k]) },
          ],
          { tricky: true, hint: `Tricky: checks against the ${POS[j]} or the ${POS[k]} digit, not both.` },
        );
      }
    }
  }

  const spread = length - 2;
  const total = randInt(rng, Math.round(length * mid) - spread, Math.round(length * mid) + spread);
  add('sumVs', '', 'All the digits add up to…', compared(String(total)), (d) => cmp(sum(d), total));
  add('sumParity', '', 'All the digits add up to…', ['even', 'odd'], (d) => sum(d) % 2);

  add('evenCount', '', 'How many digits are even?', upTo(length), (d) => d.filter((n) => n % 2 === 0).length);
  add('distinct', '', 'How many different digits are there?', upTo(length, 1), (d) => new Set(d).size - 1);

  for (let v = lo; v <= hi; v++) {
    add('countOf', `${v}`, `How many ${v}s are in the code?`, upTo(length), (d) => d.filter((n) => n === v).length);
  }

  return cards;
}
