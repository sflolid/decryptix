import { type Rng, randInt, shuffle } from './rng';

export type Digits = readonly number[];

export interface Rule {
  id: string;
  text: string;
  test: (d: Digits) => boolean;
}

const POS = ['1st', '2nd', '3rd', '4th', '5th'];
const PRIMES = new Set([2, 3, 5, 7]);

const sum = (d: Digits) => d.reduce((a, b) => a + b, 0);
const count = (d: Digits, pred: (n: number) => boolean) => d.filter(pred).length;

/**
 * Build every rule template that the secret satisfies. The puzzle generator
 * then picks a subset of these that narrows the search space to one answer.
 */
export function rulesTrueFor(secret: Digits, rng: Rng): Rule[] {
  const rules: Rule[] = [];
  const add = (id: string, text: string, test: Rule['test']) => {
    if (test(secret)) rules.push({ id, text, test });
  };

  for (let i = 0; i < 5; i++) {
    const p = POS[i];
    const v = secret[i];

    if (v % 2 === 0) add(`even${i}`, `The ${p} digit is even`, (d) => d[i] % 2 === 0);
    else add(`odd${i}`, `The ${p} digit is odd`, (d) => d[i] % 2 === 1);

    if (PRIMES.has(v)) add(`prime${i}`, `The ${p} digit is prime`, (d) => PRIMES.has(d[i]));
    else add(`notprime${i}`, `The ${p} digit is not prime`, (d) => !PRIMES.has(d[i]));

    if (v > 0) {
      const k = randInt(rng, 0, v - 1);
      add(`gt${i}`, `The ${p} digit is greater than ${k}`, (d) => d[i] > k);
    }
    if (v < 9) {
      const k = randInt(rng, v + 1, 9);
      add(`lt${i}`, `The ${p} digit is less than ${k}`, (d) => d[i] < k);
    }
  }

  for (let i = 0; i < 5; i++) {
    for (let j = i + 1; j < 5; j++) {
      const [a, b] = [secret[i], secret[j]];
      const [pa, pb] = [POS[i], POS[j]];
      if (a > b) add(`cmp${i}${j}`, `The ${pa} digit is greater than the ${pb}`, (d) => d[i] > d[j]);
      else if (a < b) add(`cmp${i}${j}`, `The ${pa} digit is less than the ${pb}`, (d) => d[i] < d[j]);
      else add(`cmp${i}${j}`, `The ${pa} and ${pb} digits match`, (d) => d[i] === d[j]);

      const s = a + b;
      add(`sum${i}${j}`, `The ${pa} and ${pb} digits add to ${s}`, (d) => d[i] + d[j] === s);

      const diff = Math.abs(a - b);
      if (diff > 0) {
        add(`diff${i}${j}`, `The ${pa} and ${pb} digits differ by ${diff}`, (d) => Math.abs(d[i] - d[j]) === diff);
      }
    }
  }

  const total = sum(secret);
  add('sumAll', `All digits add to ${total}`, (d) => sum(d) === total);
  if (total % 2 === 0) add('sumEven', 'The digit total is even', (d) => sum(d) % 2 === 0);
  else add('sumOdd', 'The digit total is odd', (d) => sum(d) % 2 === 1);
  if (total > 0) {
    const k = randInt(rng, Math.max(0, total - 8), total - 1);
    add('sumGt', `The digit total is more than ${k}`, (d) => sum(d) > k);
  }
  if (total < 45) {
    const k = randInt(rng, total + 1, Math.min(45, total + 8));
    add('sumLt', `The digit total is less than ${k}`, (d) => sum(d) < k);
  }

  const evens = count(secret, (n) => n % 2 === 0);
  add('evenCount', `Exactly ${evens} digit${evens === 1 ? ' is' : 's are'} even`, (d) => count(d, (n) => n % 2 === 0) === evens);

  const distinct = new Set(secret).size;
  if (distinct === 5) add('distinct', 'No digit repeats', (d) => new Set(d).size === 5);
  else add('distinct', `There are exactly ${distinct} different digits`, (d) => new Set(d).size === distinct);

  const present = shuffle(rng, [...new Set(secret)]).slice(0, 2);
  for (const n of present) {
    const c = count(secret, (x) => x === n);
    add(`has${n}`, c === 1 ? `Contains exactly one ${n}` : `Contains ${n} exactly ${c} times`, (d) => count(d, (x) => x === n) === c);
  }
  const absent = shuffle(rng, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((n) => !secret.includes(n))).slice(0, 2);
  for (const n of absent) {
    add(`no${n}`, `There is no ${n}`, (d) => !d.includes(n));
  }

  return rules;
}
