import { type Digits, POSITIONS, type Suit, textParts } from './cards';
import { DIFFICULTIES, DIGIT_MAX, DIGIT_MIN, type Difficulty, type Puzzle, dailyPuzzle, todayKey } from './puzzle';

const CHECKS_PER_ROUND = 3;
/** Saved progress is kept per difficulty: `${STORAGE_PREFIX}easy` etc. */
const STORAGE_PREFIX = 'decrypt:v13:';
const DIFFICULTY_KEY = 'decrypt:difficulty';
const NOTES_HIDDEN_KEY = 'decrypt:notesHidden';
const NOTES_LOCKED_KEY = 'decrypt:notesLocked';
const TIPS_HIDDEN_KEY = 'decrypt:tipsHidden';
/** 'light' or 'dark' once the player picks one; otherwise the device setting applies. */
const THEME_KEY = 'decrypt:theme';
/** Set once the "How to play" walkthrough has been shown on a first visit. */
const SEEN_HELP_KEY = 'decrypt:seenHelp';
/** Set once the player has switched to the second screen on a phone, which retires the swipe hint. */
const SWIPED_KEY = 'decrypt:swiped';
const LETTERS = 'ABCDEFGHIJ';

/** One code tested against some cards; results[i] is null if card i wasn't checked. */
interface Round {
  code: string;
  results: (boolean | null)[];
}

interface State {
  day: string;
  rounds: Round[];
  /** Whether the last round is still accepting checks (its code is locked in). */
  open: boolean;
  /** The one final answer, once submitted. */
  final: string | null;
  /** Answers the player has crossed out on each card. */
  notes: number[][];
  /** Digit notes per position, indexed by digit value: 1 crossed out, 0 not. */
  grid: number[][];
  /** Time spent on the puzzle so far (ms), counted only while the page is visible. */
  elapsed?: number;
  /** Whether the player has started (the timer starts on their first move, not on page load). */
  started?: boolean;
}

const DIGITS = Array.from({ length: DIGIT_MAX - DIGIT_MIN + 1 }, (_, i) => DIGIT_MIN + i);

const day = todayKey();

// The active difficulty's puzzle and progress; set by selectDifficulty().
let difficulty: Difficulty;
let puzzle: Puzzle;
let cards: Puzzle['cards'];
let secret: string;
/** Digits in the active code. */
let length: number;
let state: State;
/** The code being entered, one digit per slot ('' = empty). */
let entry: string[] = [];
/** The slot the keypad fills next; `length` when every slot is filled. */
let cursor = 0;
/** Which inline confirmation is showing, if any (the viewer blocks confirm() dialogs). */
let confirming: 'final' | 'restart' | null = null;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const cardsEl = $('cards');
const positionsEl = $('positions');
const slotsEl = $('slots');
const notesEl = $('notes');
const statusEl = $('status');
const actionsEl = $('actions');
const keypadEl = $('keypad');
const logEl = $('log');
const panesEl = $('panes');
const guessSlotsEl = $('guess-slots');
const levelsEl = $('levels');

const toDigits = (s: string): Digits => s.split('').map(Number);
/** Whether a code passes card i's hidden rule. */
const passes = (i: number, d: Digits) => cards[i].test(cards[i].answer, d);

const done = () => state.final !== null;
const solved = () => state.final === secret;
const currentRound = () => (state.open ? state.rounds.at(-1)! : null);
const checksIn = (r: Round) => r.results.filter((x) => x !== null).length;
/** Whether the current code has used all its checks, so the next step is a new code. */
const roundFull = () => !!currentRound() && checksIn(currentRound()!) >= CHECKS_PER_ROUND && !state.final;
const totalChecks = () => state.rounds.reduce((n, r) => n + checksIn(r), 0);
const entryComplete = () => entry.length === length && entry.every((d) => d !== '');
/** The complete code on show (the locked round's, or a fully typed entry), else ''. */
const shownCode = () => currentRound()?.code ?? (entryComplete() ? entry.join('') : '');

function canCheck(i: number): boolean {
  if (done()) return false;
  const r = currentRound();
  if (r) return r.results[i] === null && checksIn(r) < CHECKS_PER_ROUND;
  return entryComplete();
}

function fresh(): State {
  return { day, rounds: [], open: false, final: null, notes: cards.map(() => []), grid: emptyGrid(), elapsed: 0, started: false };
}

/**
 * The play timer. `state.elapsed` holds the banked time; while the timer runs,
 * `runningSince` marks when the current stretch began. It pauses while the
 * page is hidden and stops for good on the final answer.
 */
let runningSince: number | null = null;
const elapsedMs = () => (state.elapsed ?? 0) + (runningSince === null ? 0 : Date.now() - runningSince);

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** Start (or resume) the timer; called on the player's moves. */
function startTimer() {
  if (done()) return;
  state.started = true;
  if (runningSince === null && document.visibilityState === 'visible') runningSince = Date.now();
}

/** Bank the running stretch into the saved state and stop counting. */
function pauseTimer() {
  if (runningSince === null) return;
  state.elapsed = elapsedMs();
  runningSince = null;
  save();
}

function renderTimer() {
  const el = $('timer');
  el.textContent = `⏱ ${formatTime(elapsedMs())}`;
  el.classList.toggle('running', runningSince !== null);
}

function emptyGrid(): number[][] {
  return positions().map(() => Array(DIGIT_MAX + 1).fill(0));
}

/** Position markers for the active code length. */
const positions = () => POSITIONS.slice(0, length);

/** Today's saved progress for a difficulty, if any. */
function savedState(d: Difficulty): State | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_PREFIX + d) ?? 'null') as State | null;
    if (saved?.day === day) return saved;
  } catch {
    /* storage unavailable */
  }
  return null;
}

function load(): State {
  return savedState(difficulty) ?? fresh();
}

function save() {
  try {
    localStorage.setItem(STORAGE_PREFIX + difficulty, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function check(i: number) {
  if (!canCheck(i)) return;
  if (!state.open) {
    state.rounds.push({ code: entry.join(''), results: cards.map(() => null) });
    state.open = true;
    clearEntry();
  }
  startTimer();
  const r = currentRound()!;
  r.results[i] = passes(i, toDigits(r.code));
  save();
  render();
}

function toggleNote(card: number, option: number) {
  startTimer();
  const n = state.notes[card];
  const at = n.indexOf(option);
  if (at >= 0) n.splice(at, 1);
  else n.push(option);
  save();
  renderCards();
}

function clearEntry() {
  entry = Array<string>(length).fill('');
  cursor = 0;
}

/** The next empty slot after `from` (wrapping round), or `length` if all are filled. */
function nextEmpty(from: number): number {
  for (let k = 1; k <= length; k++) {
    const i = (from + k) % length;
    if (entry[i] === '') return i;
  }
  return length;
}

/**
 * Editing ends a round whose code is locked in. Typing a new digit starts a
 * fresh code; anything else (backspace, picking or dropping onto a slot)
 * edits a copy of the checked code.
 */
function unlockRound(fresh: boolean) {
  if (!state.open) return;
  if (fresh) clearEntry();
  else {
    entry = state.rounds.at(-1)!.code.split('');
    cursor = length;
  }
  state.open = false;
  save();
}

function press(key: string) {
  if (done()) return;
  startTimer();
  confirming = null;
  const n = Number(key);
  if (/^\d$/.test(key) && n >= DIGIT_MIN && n <= DIGIT_MAX) {
    unlockRound(true);
    if (cursor < length) {
      entry[cursor] = key;
      cursor = nextEmpty(cursor);
    }
  } else if (key === 'Backspace') {
    unlockRound(false);
    // Clear the selected slot if it has a digit, otherwise the last filled one before it.
    let i = cursor < length && entry[cursor] !== '' ? cursor : -1;
    for (let j = Math.min(cursor, length) - 1; i < 0 && j >= 0; j--) if (entry[j] !== '') i = j;
    if (i >= 0) {
      entry[i] = '';
      cursor = i;
    }
  } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
    unlockRound(false);
    const step = key === 'ArrowLeft' ? -1 : 1;
    cursor = Math.max(0, Math.min(length - 1, (cursor === length ? length - 1 : cursor) + step));
  }
  render();
}

/** Pick which slot the keypad fills next. */
function selectSlot(i: number) {
  if (done()) return;
  startTimer();
  confirming = null;
  unlockRound(false);
  cursor = i;
  render();
}

/** Put a digit straight into a slot (drag and drop from the keypad). */
function dropDigit(i: number, digit: string) {
  if (done()) return;
  startTimer();
  confirming = null;
  unlockRound(false);
  entry[i] = digit;
  cursor = nextEmpty(i);
  render();
}

/** Clear the checked code so the player can type the next round's code. */
function startNewCode() {
  if (!roundFull()) return;
  confirming = null;
  unlockRound(true);
  render();
  showPane(1);
}

function submitFinal() {
  const answer = shownCode();
  if (answer.length !== length || done()) return;
  pauseTimer();
  state.final = answer;
  state.open = false;
  confirming = null;
  save();
  render();
  showResult();
}

/** Pixel-art ✓ and ✗ on an 8×8 grid, to match the pixel fonts. */
const PIXEL_ICONS = {
  ok: ['........', '.......#', '......##', '#....##.', '##..##..', '.####...', '..##....', '........'],
  no: ['##....##', '###..###', '.######.', '..####..', '..####..', '.######.', '###..###', '##....##'],
};

/** SVG markup for a pixel icon: one rect per horizontal run of pixels. */
function pixelIcon(kind: keyof typeof PIXEL_ICONS, label?: string): string {
  const rects = PIXEL_ICONS[kind]
    .flatMap((row, y) => [...row.matchAll(/#+/g)].map((m) => `<rect x="${m.index}" y="${y}" width="${m[0].length}" height="1"/>`))
    .join('');
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="pix" viewBox="0 0 8 8" ${a11y}>${rects}</svg>`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG markup for each position's marker, drawn in a -1..1 box. */
const SUIT_SVG: Record<Suit, string> = {
  heart:
    '<path d="M0,0.85C-0.3,0.6 -0.95,0.2 -0.95,-0.3C-0.95,-0.7 -0.6,-0.9 -0.35,-0.9C-0.15,-0.9 0,-0.75 0,-0.55C0,-0.75 0.15,-0.9 0.35,-0.9C0.6,-0.9 0.95,-0.7 0.95,-0.3C0.95,0.2 0.3,0.6 0,0.85Z"/>',
  diamond: '<path d="M0,-0.95L0.7,0L0,0.95L-0.7,0Z"/>',
  club:
    '<circle cx="0" cy="-0.47" r="0.37"/><circle cx="-0.45" cy="0.13" r="0.37"/><circle cx="0.45" cy="0.13" r="0.37"/>' +
    '<path d="M-0.08,0L0.08,0L0.3,0.95L-0.3,0.95Z"/>',
  spade:
    '<path d="M0,-0.95C-0.3,-0.65 -0.95,-0.3 -0.95,0.15C-0.95,0.5 -0.65,0.65 -0.4,0.65C-0.2,0.65 -0.05,0.55 0,0.4C0.05,0.55 0.2,0.65 0.4,0.65C0.65,0.65 0.95,0.5 0.95,0.15C0.95,-0.3 0.3,-0.65 0,-0.95Z"/>' +
    '<path d="M-0.08,0.3L0.08,0.3L0.3,0.95L-0.3,0.95Z"/>',
  star: '<polygon points="0.000,-0.870 0.235,-0.244 0.904,-0.214 0.380,0.204 0.558,0.849 0.000,0.480 -0.558,0.849 -0.380,0.204 -0.904,-0.214 -0.235,-0.244"/>',
};

function shape(suit: Suit): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '-1 -1 2 2');
  svg.setAttribute('class', 'sym');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = SUIT_SVG[suit];
  return svg;
}

/** A position marker like "♦ 2nd", colored to match its column. */
function posChip(i: number): HTMLElement {
  const chip = document.createElement('span');
  chip.className = `pos p${i}`;
  chip.append(shape(POSITIONS[i].suit));
  chip.append(POSITIONS[i].name);
  return chip;
}

/** Fill an element with card text, rendering `{n}` as position markers. */
function fillText(el: HTMLElement, text: string) {
  el.replaceChildren(...textParts(text).map((part) => (typeof part === 'number' ? posChip(part) : part)));
}

function toggleGrid(pos: number, digit: number) {
  startTimer();
  const row = state.grid[pos];
  row[digit] = row[digit] === 1 ? 0 : 1;
  save();
  renderNotes();
}

function renderPositions() {
  positionsEl.replaceChildren(...positions().map((_, i) => posChip(i)));
}

function renderNotes() {
  notesEl.replaceChildren(
    ...positions().map((pos, i) => {
      const col = document.createElement('div');
      col.className = `note-col p${i}`;
      // Once every digit but one is crossed out, the one left is the deduction.
      const left = DIGITS.filter((d) => state.grid[i][d] !== 1);
      for (const d of DIGITS) {
        const cell = document.createElement('button');
        const crossed = state.grid[i][d] === 1;
        const deduced = !crossed && left.length === 1;
        cell.className = 'note' + (crossed ? ' crossed' : deduced ? ' deduced' : '');
        cell.textContent = String(d);
        cell.setAttribute('aria-label', `${pos.name} digit ${d}${crossed ? ', crossed out' : deduced ? ', the only one left' : ''}`);
        cell.disabled = notesLocked;
        cell.addEventListener('click', () => toggleGrid(i, d));
        col.append(cell);
      }
      return col;
    }),
  );
}

function renderCards() {
  const r = currentRound();
  cardsEl.innerHTML = '';
  cards.forEach((card, i) => {
    const el = document.createElement('article');
    el.className = 'card';

    const head = document.createElement('div');
    head.className = 'card-head';
    head.innerHTML = `<span class="card-letter">${LETTERS[i]}</span><h2 class="card-title"></h2>`;
    fillText(head.querySelector('h2')!, card.title);

    const result = r?.results[i];
    if (result != null) {
      const badge = document.createElement('span');
      badge.className = `badge ${result ? 'ok' : 'no'}`;
      badge.innerHTML = pixelIcon(result ? 'ok' : 'no');
      badge.setAttribute('aria-label', result ? 'Pass' : 'Fail');
      head.append(badge);
    } else if (!done() && !roundFull()) {
      // Once the round's checks are used up, unchecked cards just show no button.
      const btn = document.createElement('button');
      btn.className = 'check';
      btn.textContent = 'Check';
      btn.disabled = !canCheck(i);
      btn.addEventListener('click', () => check(i));
      head.append(btn);
    }
    el.append(head);
    if (card.tricky) {
      const hint = document.createElement('p');
      hint.className = 'tip tricky-hint';
      fillText(hint, card.hint ?? 'Tricky card.');
      el.append(hint);
    }

    const opts = document.createElement('div');
    opts.className = 'options';
    // Once every answer but one is crossed out, the one left is the deduction.
    const crossed = state.notes[i];
    const deduced = crossed.length === card.options.length - 1;
    // Easy only: mark the answer(s) this round's code got on a checked card, with its ✓ or ✗.
    const hintCode = DIFFICULTIES[difficulty].optionHints && r && result != null ? toDigits(r.code) : null;
    card.options.forEach((text, j) => {
      if (j > 0 && j % card.groupSize === 0) {
        const or = document.createElement('span');
        or.className = 'or';
        or.textContent = 'or';
        opts.append(or);
      }
      const opt = document.createElement('button');
      opt.className = 'option';
      fillText(opt, text);
      if (crossed.includes(j)) opt.classList.add('crossed');
      else if (deduced) opt.classList.add('deduced');
      if (done() && j === card.answer) opt.classList.add('answer');
      if (hintCode && card.test(j, hintCode)) {
        const mark = document.createElement('span');
        mark.className = `mark ${result ? 'ok' : 'no'}`;
        mark.innerHTML = pixelIcon(result ? 'ok' : 'no');
        opt.classList.add(result ? 'hit-ok' : 'hit-no');
        opt.append(mark);
        opt.setAttribute('aria-description', `Your code ${r!.code} gets this answer and ${result ? 'passed' : 'failed'}`);
      }
      opt.setAttribute('aria-pressed', String(state.notes[i].includes(j)));
      opt.disabled = done();
      opt.addEventListener('click', () => toggleNote(i, j));
      opts.append(opt);
    });
    el.append(opts);

    cardsEl.append(el);
  });
}

/**
 * Draw the code into the dock's slots (buttons: tap to pick where the next
 * digit goes, or drop a keypad digit on one) and the guess bar's mini slots.
 */
function renderSlots() {
  const shown = done() ? state.final!.split('') : state.open ? currentRound()!.code.split('') : entry;
  const locked = state.open || done();
  for (const el of [slotsEl, guessSlotsEl]) {
    const big = el === slotsEl;
    el.classList.toggle('locked', locked);
    el.replaceChildren(
      ...Array.from({ length }, (_, i) => {
        const slot = document.createElement(big ? 'button' : 'span');
        slot.className = `slot p${i}` + (i === cursor && !locked ? ' active' : '');
        slot.textContent = shown[i] ?? '';
        if (big) {
          slot.dataset.slot = String(i);
          slot.setAttribute('aria-label', `${POSITIONS[i].name} digit${shown[i] ? ` ${shown[i]}` : ', empty'}`);
          (slot as HTMLButtonElement).disabled = done();
          slot.addEventListener('click', () => selectSlot(i));
        }
        return slot;
      }),
    );
  }
}


/** A banner above the cards once a round's checks are used up: how it went, and a way on. */
/** Once the final answer is in: a banner above the cards with the outcome and a way back to the results. */
function renderResultBanner() {
  const banner = $('result-banner');
  banner.hidden = !done();
  if (banner.hidden) return;
  banner.classList.toggle('lost', !solved());
  const checks = totalChecks();
  $('result-banner-title').textContent = solved() ? '🎉 You cracked it!' : '🔒 Not this time';
  $('result-banner-sub').textContent = solved()
    ? `${checks} check${checks === 1 ? '' : 's'} · ${state.rounds.length} round${state.rounds.length === 1 ? '' : 's'} · ⏱ ${formatTime(elapsedMs())}`
    : `The code was ${secret} · ⏱ ${formatTime(elapsedMs())}`;
}

/** The next level (in order) that today's puzzle hasn't been finished on, if any. */
function nextUnfinished(): Difficulty | null {
  return (Object.keys(DIFFICULTIES) as Difficulty[]).find((d) => d !== difficulty && savedState(d)?.final == null) ?? null;
}

/** Colored code slots, for the results dialog. */
function codeSlots(code: string): HTMLElement[] {
  return [...code].map((d, i) => {
    const slot = document.createElement('span');
    slot.className = `slot p${i}`;
    slot.textContent = d;
    return slot;
  });
}

const resultDialog = $<HTMLDialogElement>('result');

/** The big win / loss screen: shown on submitting, and again from the banner. */
function showResult(celebrate = true) {
  const won = solved();
  const checks = totalChecks();
  resultDialog.classList.toggle('lost', !won);
  $('result-emoji').textContent = won ? '🎉' : '🔒';
  $('result-title').textContent = won ? 'Congrats! You cracked it!' : 'Not this time';
  $('result-sub').textContent = `Decryptix #${puzzle.number} · ${DIFFICULTIES[difficulty].label}`;
  $('result-code-label').textContent = won ? 'The secret code' : 'The code was';
  const codeEl = $('result-code');
  codeEl.style.setProperty('--cols', String(length));
  codeEl.replaceChildren(...codeSlots(secret));
  const answerEl = $('result-answer');
  answerEl.hidden = won;
  if (!won) {
    answerEl.innerHTML = `You answered <span class="used-code">${[...state.final!].map((d, i) => `<span class="p${i}">${d}</span>`).join('')}</span>`;
  }
  $('result-checks').textContent = String(checks);
  $('result-rounds').textContent = String(state.rounds.length);
  $('result-time').textContent = formatTime(elapsedMs());
  $('result-grid').textContent = state.rounds.map((r) => r.results.map((x) => (x === null ? '⬛' : x ? '🟩' : '🟥')).join('')).join('\n');
  $('result-text').hidden = true;
  const next = nextUnfinished();
  const nextBtn = $('result-next');
  nextBtn.hidden = !next;
  if (next) nextBtn.textContent = `Try ${DIFFICULTIES[next].label} ›`;
  if (!resultDialog.open) resultDialog.showModal();
  $('result-copy').focus();
  if (won && celebrate) confetti();
}

/** A burst of pixel confetti in the position colors. */
function confetti() {
  if (reducedMotion) return;
  const layer = $('confetti');
  layer.replaceChildren(
    ...Array.from({ length: 70 }, () => {
      const bit = document.createElement('span');
      bit.className = `p${Math.floor(Math.random() * POSITIONS.length)}`;
      bit.style.left = `${Math.random() * 100}%`;
      bit.style.animationDelay = `${Math.random() * 0.8}s`;
      bit.style.animationDuration = `${2.2 + Math.random() * 1.6}s`;
      bit.style.setProperty('--drift', `${(Math.random() - 0.5) * 160}px`);
      bit.style.setProperty('--spin', `${(Math.random() - 0.5) * 1440}deg`);
      return bit;
    }),
  );
  setTimeout(() => layer.replaceChildren(), 4600);
}

function renderRoundBanner() {
  const banner = $('round-banner');
  banner.hidden = !roundFull();
  if (banner.hidden) return;
  const r = currentRound()!;
  $('round-banner-title').textContent = `Round ${state.rounds.length} done: all ${CHECKS_PER_ROUND} checks used`;
  $('round-banner-results').innerHTML = r.results
    .map((x, i) =>
      x === null ? '' : `<span class="${x ? 'ok' : 'no'}">${LETTERS[i]} ${pixelIcon(x ? 'ok' : 'no', x ? 'pass' : 'fail')}</span>`,
    )
    .join('');
}

/** The dock's list of checked codes under "Your code", most recent first. */
function renderUsed() {
  $('used').hidden = !state.rounds.length;
  $('used').innerHTML = state.rounds
    .map((r, n) => {
      const digits = [...r.code].map((d, i) => `<span class="p${i}">${d}</span>`).join('');
      const results = r.results
        .map((x, i) =>
          x === null ? '' : `<span class="${x ? 'ok' : 'no'}">${LETTERS[i]}${pixelIcon(x ? 'ok' : 'no', x ? 'pass' : 'fail')}</span>`,
        )
        .join('');
      return `<li><span class="used-round">${n + 1}</span><span class="used-code">${digits}</span><span class="used-results">${results}</span></li>`;
    })
    .reverse()
    .join('');
}

function renderStatus() {
  const checks = totalChecks();
  const rounds = state.rounds.length;
  const tally = `${checks} check${checks === 1 ? '' : 's'} · ${rounds} round${rounds === 1 ? '' : 's'}`;
  statusEl.className = 'status';

  if (done()) {
    statusEl.classList.add(solved() ? 'win' : 'lose');
    statusEl.textContent = solved()
      ? `🎉 You cracked it! ${tally}`
      : `Wrong code. The secret was ${secret}. ${tally}`;
  } else if (confirming === 'final') {
    statusEl.textContent = `Submit ${shownCode()} as your final answer? You only get one.`;
  } else if (confirming === 'restart') {
    statusEl.textContent = "Restart today's puzzle? This clears your checks and notes.";
  } else if (state.open) {
    const left = CHECKS_PER_ROUND - checksIn(currentRound()!);
    statusEl.textContent = left
      ? `Round ${rounds}: ${left} check${left === 1 ? '' : 's'} left for this code. ${tally}`
      : `Round ${rounds} done. Type a new code, or tap Start a new code. ${tally}`;
  } else if (!entryComplete()) {
    statusEl.textContent = rounds
      ? `Enter a new code. ${tally}`
      : 'Type a code, or drag digits onto the slots, then check it against up to 3 cards.';
  } else {
    statusEl.textContent = `Pick up to 3 cards to check ${entry.join('')} against. ${tally}`;
  }
}

function renderActions() {
  actionsEl.innerHTML = '';
  const button = (label: string, cls: string, onClick: (b: HTMLButtonElement) => void, disabled = false) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = cls;
    b.disabled = disabled;
    b.addEventListener('click', () => onClick(b));
    actionsEl.append(b);
  };

  const ask = (what: typeof confirming) => () => {
    confirming = what;
    render();
  };

  if (confirming) {
    button(confirming === 'final' ? 'Submit final answer' : 'Restart', 'action primary', confirming === 'final' ? submitFinal : restart);
    button('Cancel', 'action', ask(null));
    return;
  }
  if (done()) button('Copy results', 'action primary', copyResults);
  else button('Submit final answer…', 'action primary', ask('final'), shownCode() === '');
  if (!notesHidden) button(notesLocked ? '🔒 Unlock notes' : '🔓 Lock notes', 'action', toggleNotesLock);
  button(notesHidden ? 'Show notes' : 'Hide notes', 'action', toggleNotesPanel);
  button('Restart', 'action', ask('restart'));
}

function restart() {
  runningSince = null;
  Object.assign(state, fresh());
  clearEntry();
  resultsBox.hidden = true;
  confirming = null;
  save();
  render();
}

/** Per-viewer on/off preferences, kept in localStorage when it's available. */
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

let notesHidden = readFlag(NOTES_HIDDEN_KEY);
let notesLocked = readFlag(NOTES_LOCKED_KEY);

let tipsHidden = readFlag(TIPS_HIDDEN_KEY);

const tipsToggle = $<HTMLInputElement>('tips-toggle');
tipsToggle.checked = !tipsHidden;
tipsToggle.addEventListener('change', () => {
  tipsHidden = !tipsToggle.checked;
  writeFlag(TIPS_HIDDEN_KEY, tipsHidden);
  render();
});

/**
 * Light / dark theme. The stylesheet follows the device setting unless the
 * root has data-theme set, so picking one just sets that attribute.
 */
const themeToggle = $('theme-toggle');
const activeTheme = (): 'light' | 'dark' => {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};
function applyTheme(theme?: 'light' | 'dark') {
  if (theme) document.documentElement.dataset.theme = theme;
  const dark = activeTheme() === 'dark';
  themeToggle.textContent = dark ? '☀' : '☾';
  themeToggle.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  themeToggle.title = themeToggle.getAttribute('aria-label')!;
}
try {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === 'light' || saved === 'dark' ? saved : undefined);
} catch {
  applyTheme();
}
themeToggle.addEventListener('click', () => {
  const next = activeTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* ignore */
  }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());

function toggleNotesPanel() {
  notesHidden = !notesHidden;
  writeFlag(NOTES_HIDDEN_KEY, notesHidden);
  render();
}

function toggleNotesLock() {
  notesLocked = !notesLocked;
  writeFlag(NOTES_LOCKED_KEY, notesLocked);
  render();
}

function renderLog() {
  logEl.innerHTML = '';
  $('log-section').hidden = !state.rounds.length;
  if (!state.rounds.length) return;
  const head = cards.map((_, i) => `<th scope="col">${LETTERS[i]}</th>`).join('');
  const rows = state.rounds
    .map((r, n) => {
      const cells = r.results
        .map((x) => (x === null ? '<td></td>' : `<td class="${x ? 'ok' : 'no'}">${pixelIcon(x ? 'ok' : 'no', x ? 'Pass' : 'Fail')}</td>`))
        .join('');
      const digits = [...r.code].map((d, i) => `<span class="p${i}">${d}</span>`).join('');
      return `<tr><th scope="row">${n + 1}</th><td class="code">${digits}</td>${cells}</tr>`;
    })
    .join('');
  logEl.innerHTML = `<thead><tr><th scope="col">#</th><th scope="col">Code</th>${head}</tr></thead><tbody>${rows}</tbody>`;
}

function render() {
  renderCards();
  renderSlots();
  renderNotes();
  renderStatus();
  renderActions();
  $('notes-section').hidden = notesHidden;
  document.body.classList.toggle('no-tips', tipsHidden);
  notesEl.classList.toggle('locked', notesLocked);
  keypadEl.classList.toggle('disabled', done());
  // Phones only: once a code is ready to check, point back to the cards screen.
  $('to-cards').hidden = !cards.some((_, i) => canCheck(i));
  $('new-code-dock').hidden = !roundFull();
  $('guess-go').textContent = done()
    ? 'Done'
    : roundFull()
      ? 'New code ›'
      : shownCode() || entry.some((d) => d !== '')
        ? 'Code ›'
        : 'Enter a code ›';
  $('guessbar').classList.toggle('attention', roundFull());
  renderRoundBanner();
  renderResultBanner();
  renderTimer();
  renderUsed();
  renderLog();
  renderLevels();
}

/**
 * A spoiler-free summary of the game: one line per round with a block per
 * card (🟩 passed, 🟥 failed, ⬛ not checked that round), then the outcome.
 */
function resultsText(): string {
  const checks = totalChecks();
  const rounds = state.rounds.length;
  const tally = `${checks} check${checks === 1 ? '' : 's'} in ${rounds} round${rounds === 1 ? '' : 's'}`;
  const grid = state.rounds.map((r) => r.results.map((x) => (x === null ? '⬛' : x ? '🟩' : '🟥')).join(''));
  const outcome = solved() ? `🔓 Decryption completed! ${tally}` : `🔒 Decryption failed. ${tally}`;
  const time = `⏱ ${formatTime(elapsedMs())}`;
  return [`DECRYPTIX #${puzzle.number} · ${DIFFICULTIES[difficulty].label} · ${length} digits`, ...grid, outcome, time].join('\n');
}

const resultsBox = $<HTMLTextAreaElement>('results-text');

/** Copy the results; if the clipboard is blocked, show them selected for copying by hand. */
async function copyResults(button: HTMLButtonElement, box = resultsBox) {
  const text = resultsText();
  try {
    await navigator.clipboard.writeText(text);
    box.hidden = true;
    button.textContent = 'Copied!';
    statusEl.textContent = "Results copied. Paste them anywhere; they don't give away the code.";
    setTimeout(() => (button.textContent = 'Copy results'), 2000);
  } catch {
    box.value = text;
    box.rows = text.split('\n').length;
    box.hidden = false;
    box.select();
    statusEl.textContent = "Couldn't reach the clipboard. Your results are selected below: copy them from there.";
  }
}

/**
 * Dragging a keypad digit onto a slot. Uses pointer events so it works with
 * touch as well as a mouse; a press that doesn't move is an ordinary tap.
 */
let drag: { digit: string; x: number; y: number; ghost: HTMLElement | null } | null = null;
/** Set right after a drag so the key's click (if the drag ends on it) is ignored. */
let suppressClick = false;

const slotUnder = (e: PointerEvent) =>
  (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-slot]') ?? null;

function markDropTarget(target: HTMLElement | null) {
  for (const s of slotsEl.querySelectorAll('.drop-target')) s.classList.remove('drop-target');
  target?.classList.add('drop-target');
}

function endDrag() {
  drag?.ghost?.remove();
  drag = null;
  markDropTarget(null);
}

document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.ghost) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
    drag.ghost = document.createElement('div');
    drag.ghost.className = 'drag-ghost';
    drag.ghost.textContent = drag.digit;
    document.body.append(drag.ghost);
  }
  drag.ghost.style.left = `${e.clientX}px`;
  drag.ghost.style.top = `${e.clientY}px`;
  markDropTarget(slotUnder(e));
});

document.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const { digit, ghost } = drag;
  const target = ghost ? slotUnder(e) : null;
  endDrag();
  if (!ghost) return; // a plain tap: the key's click handler presses it
  suppressClick = true;
  setTimeout(() => (suppressClick = false));
  if (target) dropDigit(Number(target.dataset.slot), digit);
});
document.addEventListener('pointercancel', endDrag);

function buildKeypad() {
  const digits = DIGITS.map(String);
  for (const k of [...digits, 'Backspace']) {
    const btn = document.createElement('button');
    btn.textContent = k === 'Backspace' ? '⌫' : k;
    btn.className = 'key';
    btn.setAttribute('aria-label', k);
    btn.addEventListener('click', () => !suppressClick && press(k));
    if (k !== 'Backspace') {
      btn.addEventListener('pointerdown', (e) => {
        if (!done()) drag = { digit: k, x: e.clientX, y: e.clientY, ghost: null };
      });
    }
    keypadEl.append(btn);
  }
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || help.open || resultDialog.open) return;
  if (/^\d$/.test(e.key) || ['Backspace', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();
    press(e.key);
  }
});

$('digit-range').textContent = `${DIGIT_MIN}–${DIGIT_MAX}`;
function savedDifficulty(): Difficulty {
  try {
    const d = localStorage.getItem(DIFFICULTY_KEY);
    if (d && d in DIFFICULTIES) return d as Difficulty;
  } catch {
    /* ignore */
  }
  return 'easy';
}

/** Switch to a difficulty's daily puzzle, restoring today's progress on it. */
function selectDifficulty(d: Difficulty) {
  // Bank the level being left; the new one resumes only if the player had started it.
  if (state) pauseTimer();
  difficulty = d;
  try {
    localStorage.setItem(DIFFICULTY_KEY, d);
  } catch {
    /* ignore */
  }
  puzzle = puzzleFor(d);
  cards = puzzle.cards;
  secret = puzzle.secret.join('');
  length = puzzle.secret.length;
  state = load();
  if (state.started) startTimer();
  clearEntry();
  confirming = null;
  resultsBox.hidden = true;
  document.documentElement.style.setProperty('--cols', String(length));
  $('puzzle-no').textContent = `#${puzzle.number}`;
  renderPositions();
  render();
}

/** Difficulty switcher, showing each level's code length and marking finished ones. */
function renderLevels() {
  levelsEl.replaceChildren(
    ...(Object.keys(DIFFICULTIES) as Difficulty[]).map((d) => {
      const { label } = DIFFICULTIES[d];
      const p = puzzles.get(d);
      const saved = d === difficulty ? state : savedState(d);
      const result =
        !p || saved?.final == null
          ? ''
          : ` ${saved.final === p.secret.join('') ? pixelIcon('ok', 'solved') : pixelIcon('no', 'missed')}`;
      const btn = document.createElement('button');
      btn.className = 'level';
      btn.setAttribute('aria-pressed', String(d === difficulty));
      btn.innerHTML = `<span class="level-name"></span><span class="level-len">${p ? `${p.secret.length} digits` : '…'}${result}</span>`;
      btn.querySelector('.level-name')!.textContent = label;
      btn.addEventListener('click', () => d !== difficulty && selectDifficulty(d));
      return btn;
    }),
  );
}

/** Today's puzzle per difficulty, generated on first use. */
const puzzles = new Map<Difficulty, Puzzle>();
function puzzleFor(d: Difficulty): Puzzle {
  if (!puzzles.has(d)) puzzles.set(d, dailyPuzzle(d, day));
  return puzzles.get(d)!;
}

/**
 * Generate the other levels' puzzles after the page is showing, one per
 * tick, so the level buttons can show their code lengths and results.
 */
function preloadOtherLevels() {
  const next = (Object.keys(DIFFICULTIES) as Difficulty[]).find((d) => !puzzles.has(d));
  if (!next) return;
  setTimeout(() => {
    puzzleFor(next);
    renderLevels();
    preloadOtherLevels();
  }, 0);
}

// On narrow screens the cards and the dock are two side-by-side panes that
// swipe (scroll-snap) horizontally; the tabs mirror and drive which is showing.
const tabs = [$('tab-0'), $('tab-1')];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function showPane(i: number) {
  panesEl.scrollTo({ left: i * panesEl.clientWidth, behavior: reducedMotion ? 'auto' : 'smooth' });
}

tabs.forEach((tab, i) => tab.addEventListener('click', () => showPane(i)));
$('guessbar').addEventListener('click', () => showPane(1));
$('to-cards').addEventListener('click', () => showPane(0));
$('new-code').addEventListener('click', startNewCode);
$('result-banner-open').addEventListener('click', () => showResult(false));
$('result-copy').addEventListener('click', (e) => copyResults(e.currentTarget as HTMLButtonElement, $<HTMLTextAreaElement>('result-text')));
$('result-close').addEventListener('click', () => resultDialog.close());
$('result-next').addEventListener('click', () => {
  const next = nextUnfinished();
  resultDialog.close();
  if (next) selectDifficulty(next);
});
resultDialog.addEventListener('click', (e) => e.target === resultDialog && resultDialog.close());
$('new-code-dock').addEventListener('click', startNewCode);
const swipeHint = $('swipe-hint');
swipeHint.hidden = readFlag(SWIPED_KEY);
panesEl.addEventListener(
  'scroll',
  () => {
    const current = Math.round(panesEl.scrollLeft / Math.max(1, panesEl.clientWidth));
    tabs.forEach((tab, i) => tab.setAttribute('aria-selected', String(i === current)));
    if (current === 1 && !swipeHint.hidden) {
      swipeHint.hidden = true;
      writeFlag(SWIPED_KEY, true);
    }
  },
  { passive: true },
);

/** Slide both panes over briefly so a new player sees there's a second screen. */
function peekPanes() {
  if (reducedMotion || panesEl.scrollWidth <= panesEl.clientWidth || readFlag(SWIPED_KEY)) return;
  panesEl.classList.add('peek');
  panesEl.addEventListener('animationend', () => panesEl.classList.remove('peek'), { once: true });
}

/**
 * "How to play": a dialog of short steps that swipe sideways (scroll-snap),
 * with dots and Back / Next. Steps marked mobile-only are hidden on wide screens.
 */
const help = $<HTMLDialogElement>('help');
const helpSteps = $('help-steps');
const helpBack = $('help-back');
const helpNext = $('help-next');
const helpDots = $('help-dots');
let helpStep = 0;
/** Whether closing the walkthrough should then show off the swipeable panes. */
let peekAfterHelp = false;

const visibleSteps = () => [...helpSteps.children].filter((el) => getComputedStyle(el).display !== 'none');

function renderHelpNav() {
  const count = visibleSteps().length;
  helpBack.setAttribute('aria-hidden', String(helpStep === 0));
  (helpBack as HTMLButtonElement).disabled = helpStep === 0;
  helpNext.textContent = helpStep === count - 1 ? 'Play!' : 'Next ›';
  helpDots.replaceChildren(
    ...Array.from({ length: count }, (_, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'dot';
      dot.setAttribute('aria-label', `Step ${i + 1} of ${count}`);
      if (i === helpStep) dot.setAttribute('aria-current', 'step');
      dot.addEventListener('click', () => goToStep(i));
      return dot;
    }),
  );
}

function goToStep(i: number) {
  helpStep = Math.max(0, Math.min(visibleSteps().length - 1, i));
  helpSteps.scrollTo({ left: helpStep * helpSteps.clientWidth, behavior: reducedMotion ? 'auto' : 'smooth' });
  renderHelpNav();
}

function openHelp() {
  help.showModal();
  helpSteps.scrollLeft = 0;
  helpStep = 0;
  renderHelpNav();
  helpNext.focus();
}

helpSteps.addEventListener(
  'scroll',
  () => {
    const at = Math.round(helpSteps.scrollLeft / Math.max(1, helpSteps.clientWidth));
    if (at !== helpStep) {
      helpStep = at;
      renderHelpNav();
    }
  },
  { passive: true },
);
helpBack.addEventListener('click', () => goToStep(helpStep - 1));
helpNext.addEventListener('click', () => (helpStep >= visibleSteps().length - 1 ? help.close() : goToStep(helpStep + 1)));
$('help-skip').addEventListener('click', () => help.close());
$('help-btn').addEventListener('click', openHelp);
// A click on the dialog element itself is a click on the backdrop around it.
help.addEventListener('click', (e) => e.target === help && help.close());
help.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    goToStep(helpStep + (e.key === 'ArrowLeft' ? -1 : 1));
  }
});
help.addEventListener('close', () => {
  if (!peekAfterHelp) return;
  peekAfterHelp = false;
  setTimeout(peekPanes, 300);
});

buildKeypad();
// Swap the text ✓ / ✗ in the page's help copy for the pixel icons,
// and render `{n}` in help text as position markers.
for (const el of document.querySelectorAll<HTMLElement>('[data-icon]')) {
  const kind = el.dataset.icon === 'ok' ? 'ok' : 'no';
  el.innerHTML = pixelIcon(kind, kind === 'ok' ? 'pass' : 'fail');
}
for (const el of document.querySelectorAll<HTMLElement>('[data-text]')) fillText(el, el.dataset.text!);

selectDifficulty(savedDifficulty());
preloadOtherLevels();

// Tick the timer display, and bank the time every few seconds in case the page is closed abruptly.
let ticks = 0;
setInterval(() => {
  renderTimer();
  if (runningSince !== null && ++ticks % 5 === 0) {
    pauseTimer();
    startTimer();
  }
}, 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') pauseTimer();
  else if (state.started) startTimer();
  renderTimer();
});
window.addEventListener('pagehide', pauseTimer);

// Walk first-time visitors through how to play.
if (!readFlag(SEEN_HELP_KEY)) {
  writeFlag(SEEN_HELP_KEY, true);
  peekAfterHelp = true;
  openHelp();
}
