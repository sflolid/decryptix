import { describe, expect, it } from 'vitest';
import { dailyPuzzle, generatePuzzle, puzzleNumber, solutions } from './puzzle';

describe('generatePuzzle', () => {
  it('is deterministic for a given seed', () => {
    const a = generatePuzzle('seed-1');
    const b = generatePuzzle('seed-1');
    expect(a.secret).toEqual(b.secret);
    expect(a.rules.map((r) => r.text)).toEqual(b.rules.map((r) => r.text));
  });

  it('produces rules with exactly one solution: the secret', () => {
    for (let i = 0; i < 20; i++) {
      const p = generatePuzzle(`seed-${i}`);
      expect(p.rules.length).toBeLessThanOrEqual(8);
      expect(solutions(p.rules)).toEqual([p.secret]);
    }
  });
});

describe('daily', () => {
  it('numbers puzzles from the launch date', () => {
    expect(puzzleNumber('2026-09-22')).toBe(1);
    expect(puzzleNumber('2026-09-23')).toBe(2);
    expect(dailyPuzzle('2026-09-22').number).toBe(1);
  });
});
