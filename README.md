# Decrypt

A daily code-breaking puzzle, in the spirit of Wordle and Turing Machine.

Each day there are three puzzles: **Easy** (3-digit code), **Medium** (4 digits) and **Hard** (5 digits),
all using digits 1–6. Each puzzle has a set of **rule cards**. A card asks a question ("The ▲ 2nd digit
is… < 3 / = 3 / > 3") and lists every possible answer; the answers never overlap, so every code gets
exactly one. Each card secretly checks the secret's answer.

Enter any code and check it against up to 3 cards per round: a card shows ✓ if your code gets the
same answer as the secret, ✗ if not. Work out every card's answer, deduce the code, and submit one
final answer. Your score is how few checks you needed.

**Tricky cards** turn up at random (more often on harder levels):

- *Gap* cards ask how far apart two digits are (0–5) without saying which is bigger.
- *Either* cards compare a digit with one of two others (e.g. vs the 2nd **or** the 3rd digit) and
  only check one of those comparisons.

Everyone gets the same puzzles each day: they're generated from a seed based on the date.

## Development

```sh
npm install
npm run dev             # start the dev server
npm test                # run tests
npm run build           # type-check and build to dist/
npm run build:artifact  # also bundle a single self-contained dist/artifact.html
```

## Layout

- `src/cards.ts` – rule card types and the position markers (● ▲ ■ ⬟ ⬢)
- `src/puzzle.ts` – difficulties, daily seeding, and the generator that picks a minimal set of cards
  leaving exactly one possible code
- `src/rng.ts` – seeded PRNG helpers
- `src/main.ts` – UI and game state (saved per difficulty in `localStorage`)
- `scripts/build-artifact.mjs` – inlines the build into one HTML page for hosted previews
