import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { cardPool } from './cards';
import {
  DIFFICULTIES,
  DIGIT_MAX,
  DIGIT_MIN,
  type Difficulty,
  MAX_LENGTH,
  MIN_LENGTH,
  dailyPuzzle,
  generatePuzzle,
  puzzleNumber,
  solutions,
} from './puzzle';
import { mulberry32 } from './rng';

const levels = Object.keys(DIFFICULTIES) as Difficulty[];

describe.each(levels)('generatePuzzle (%s)', (difficulty) => {
  const { score, checks } = DIFFICULTIES[difficulty];

  it('is deterministic for a given seed', () => {
    const a = generatePuzzle('seed-1', difficulty);
    const b = generatePuzzle('seed-1', difficulty);
    expect(a.secret).toEqual(b.secret);
    expect(a.cards.map((c) => c.id)).toEqual(b.cards.map((c) => c.id));
  });

  it('makes 3- to 5-digit codes from digits in range', () => {
    for (let i = 0; i < 15; i++) {
      const { secret } = generatePuzzle(`seed-${i}`, difficulty);
      expect(secret.length).toBeGreaterThanOrEqual(MIN_LENGTH);
      expect(secret.length).toBeLessThanOrEqual(MAX_LENGTH);
      for (const d of secret) {
        expect(d).toBeGreaterThanOrEqual(DIGIT_MIN);
        expect(d).toBeLessThanOrEqual(DIGIT_MAX);
      }
    }
  });

  it("makes the secret the only code passing every card, within the level's bands", () => {
    for (let i = 0; i < 15; i++) {
      const p = generatePuzzle(`seed-${i}`, difficulty);
      expect(solutions(p)).toEqual([p.secret]);
      for (const card of p.cards) expect(card.test(card.answer, p.secret), card.id).toBe(true);
      expect(p.analysis.score).toBeGreaterThanOrEqual(score[0]);
      expect(p.analysis.score).toBeLessThanOrEqual(score[1]);
      expect(p.analysis.checks).toBeGreaterThanOrEqual(checks[0]);
      expect(p.analysis.checks).toBeLessThanOrEqual(checks[1]);
      expect(p.analysis).toEqual(analyze(p.cards, p.secret.length, DIGIT_MIN, DIGIT_MAX));
    }
  });

  it('never includes a redundant card', () => {
    for (let i = 0; i < 8; i++) {
      const p = generatePuzzle(`seed-${i}`, difficulty);
      for (let c = 0; c < p.cards.length; c++) {
        const without = { ...p, cards: p.cards.filter((_, j) => j !== c) };
        expect(solutions(without).length).toBeGreaterThan(1);
      }
    }
  });
});

describe.each([3, 4, 5])('cardPool (%i digits)', (length) => {
  it('gives every code exactly one answer per group on every card, and every answer is possible', () => {
    const codes: number[][] = [];
    const walk = (prefix: number[]) => {
      if (prefix.length === length) return void codes.push(prefix);
      for (let v = DIGIT_MIN; v <= DIGIT_MAX; v++) walk([...prefix, v]);
    };
    walk([]);

    const pool = cardPool(mulberry32(1), DIGIT_MIN, DIGIT_MAX, length);
    expect(pool.some((c) => c.kind === 'gap')).toBe(true);
    expect(pool.some((c) => c.kind === 'either')).toBe(true);
    for (const card of pool) {
      const seen = new Set<number>();
      for (const code of codes) {
        const passed = card.options.map((_, j) => j).filter((j) => card.test(j, code));
        const groups = passed.map((j) => Math.floor(j / card.groupSize));
        expect(groups, card.id).toEqual([...Array(card.options.length / card.groupSize).keys()]);
        for (const j of passed) seen.add(j);
      }
      expect(seen.size, `${card.id} has an answer no code can reach`).toBe(card.options.length);
    }
    // Runs every code through every card: slow for 5-digit codes.
  }, 60_000);
});

describe('analyze', () => {
  it('scores a one-clue-at-a-time puzzle low and a combined-clue puzzle higher', () => {
    const easy = generatePuzzle('analyze-easy', 'easy');
    const hard = generatePuzzle('analyze-hard', 'hard');
    expect(easy.analysis.pairRounds).toBe(0);
    expect(easy.analysis.needsSearch).toBe(false);
    expect(hard.analysis.score).toBeGreaterThan(easy.analysis.score);
    expect(hard.analysis.checks).toBeGreaterThan(easy.analysis.checks);
  });

  it('records a checks estimate for generated puzzles', () => {
    const p = generatePuzzle('analyze-checks', 'medium');
    expect(p.analysis.checks).toBeGreaterThan(0);
    // With every card checked against the secret itself, all must pass.
    for (const card of p.cards) expect(card.test(card.answer, p.secret)).toBe(true);
  });
});

describe('daily', () => {
  it('numbers puzzles from the launch date', () => {
    expect(puzzleNumber('2026-09-22')).toBe(1);
    expect(puzzleNumber('2026-09-23')).toBe(2);
    expect(dailyPuzzle('easy', '2026-09-22').number).toBe(1);
  });

  it('gives each difficulty its own puzzle', () => {
    const secrets = levels.map((d) => dailyPuzzle(d, '2026-09-23').secret.join(''));
    expect(new Set(secrets).size).toBe(levels.length);
  });
});
