# Decrypt

A daily code-breaking puzzle, in the spirit of Wordle.

Each day there's a secret 5-digit code and a set of **rule tiles** (e.g. "The 2nd digit is odd",
"The 1st and 4th digits add to 11", "There is no 7"). The rules are chosen so that exactly one
code satisfies all of them. Enter a guess and each tile lights up green or red to show whether
your guess passes that rule. Crack the code in 6 attempts.

Everyone gets the same puzzle each day: it's generated from a seed based on the date.

## Development

```sh
npm install
npm run dev     # start the dev server
npm test        # run tests
npm run build   # type-check and build to dist/
```

## Layout

- `src/rules.ts` – rule templates, instantiated for a given secret
- `src/puzzle.ts` – daily seeding and the generator that picks a minimal, unique rule set
- `src/rng.ts` – seeded PRNG helpers
- `src/main.ts` – UI and game state (saved to `localStorage`)
