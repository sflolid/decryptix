import { type Digits, POSITIONS, textParts } from './cards';
import { DIFFICULTIES, DIGIT_MAX, DIGIT_MIN, type Difficulty, type Puzzle, dailyPuzzle, todayKey } from './puzzle';

const CHECKS_PER_ROUND = 3;
/** Saved progress is kept per difficulty: `${STORAGE_PREFIX}easy` etc. */
const STORAGE_PREFIX = 'decrypt:v12:';
const DIFFICULTY_KEY = 'decrypt:difficulty';
const NOTES_HIDDEN_KEY = 'decrypt:notesHidden';
const NOTES_LOCKED_KEY = 'decrypt:notesLocked';
const TIPS_HIDDEN_KEY = 'decrypt:tipsHidden';
/** 'light' or 'dark' once the player picks one; otherwise the device setting applies. */
const THEME_KEY = 'decrypt:theme';
/** Set once "How to play" has been shown open on a first visit. */
const SEEN_HELP_KEY = 'decrypt:seenHelp';
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
const guessStatusEl = $('guess-status');
const levelsEl = $('levels');

const toDigits = (s: string): Digits => s.split('').map(Number);
/** Whether a code passes card i's hidden rule. */
const passes = (i: number, d: Digits) => cards[i].test(cards[i].answer, d);

const done = () => state.final !== null;
const solved = () => state.final === secret;
const currentRound = () => (state.open ? state.rounds.at(-1)! : null);
const checksIn = (r: Round) => r.results.filter((x) => x !== null).length;
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
  return { day, rounds: [], open: false, final: null, notes: cards.map(() => []), grid: emptyGrid() };
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
  const r = currentRound()!;
  r.results[i] = passes(i, toDigits(r.code));
  save();
  render();
}

function toggleNote(card: number, option: number) {
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
  confirming = null;
  unlockRound(false);
  cursor = i;
  render();
}

/** Put a digit straight into a slot (drag and drop from the keypad). */
function dropDigit(i: number, digit: string) {
  if (done()) return;
  confirming = null;
  unlockRound(false);
  entry[i] = digit;
  cursor = nextEmpty(i);
  render();
}

function submitFinal() {
  const answer = shownCode();
  if (answer.length !== length || done()) return;
  state.final = answer;
  state.open = false;
  confirming = null;
  save();
  render();
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A regular polygon with `sides` edges (0 draws a circle), flat-bottomed where possible. */
function shape(sides: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '-1 -1 2 2');
  svg.setAttribute('class', 'sym');
  svg.setAttribute('aria-hidden', 'true');
  if (sides === 0) {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('r', '0.85');
    svg.append(c);
  } else {
    const start = -Math.PI / 2 + (sides % 2 === 0 ? Math.PI / sides : 0);
    const pts = Array.from({ length: sides }, (_, k) => {
      const a = start + (2 * Math.PI * k) / sides;
      return `${Math.cos(a).toFixed(3)},${Math.sin(a).toFixed(3)}`;
    });
    const p = document.createElementNS(SVG_NS, 'polygon');
    p.setAttribute('points', pts.join(' '));
    svg.append(p);
  }
  return svg;
}

/** A position marker like "▲ 2nd", colored to match its column. */
function posChip(i: number): HTMLElement {
  const chip = document.createElement('span');
  chip.className = `pos p${i}`;
  chip.append(shape(POSITIONS[i].sides));
  chip.append(POSITIONS[i].name);
  return chip;
}

/** Fill an element with card text, rendering `{n}` as position markers. */
function fillText(el: HTMLElement, text: string) {
  el.replaceChildren(...textParts(text).map((part) => (typeof part === 'number' ? posChip(part) : part)));
}

function toggleGrid(pos: number, digit: number) {
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
      badge.textContent = result ? '✓' : '✗';
      badge.setAttribute('aria-label', result ? 'Pass' : 'Fail');
      head.append(badge);
    } else if (!done()) {
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
  guessStatusEl.textContent = shortStatus();
}

/** A few words for the guess bar on the cards column. */
function shortStatus(): string {
  if (done()) return solved() ? 'Decrypted!' : 'Game over';
  const r = currentRound();
  if (r) {
    const left = CHECKS_PER_ROUND - checksIn(r);
    return left ? `${left} check${left === 1 ? '' : 's'} left` : 'Round done: new code';
  }
  return entryComplete() ? 'Pick cards to check' : 'Type a code';
}

function renderStatus() {
  const checks = totalChecks();
  const rounds = state.rounds.length;
  const tally = `${checks} check${checks === 1 ? '' : 's'} · ${rounds} round${rounds === 1 ? '' : 's'}`;
  statusEl.className = 'status';

  if (done()) {
    statusEl.classList.add(solved() ? 'win' : 'lose');
    statusEl.textContent = solved()
      ? `Decrypted! ${tally}`
      : `Wrong code. The secret was ${secret}. ${tally}`;
  } else if (confirming === 'final') {
    statusEl.textContent = `Submit ${shownCode()} as your final answer? You only get one.`;
  } else if (confirming === 'restart') {
    statusEl.textContent = "Restart today's puzzle? This clears your checks and notes.";
  } else if (state.open) {
    const left = CHECKS_PER_ROUND - checksIn(currentRound()!);
    statusEl.textContent = left
      ? `Round ${rounds}: ${left} check${left === 1 ? '' : 's'} left for this code. ${tally}`
      : `Round ${rounds} done. Type a new code for the next round. ${tally}`;
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
  const button = (label: string, cls: string, onClick: () => void, disabled = false) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = cls;
    b.disabled = disabled;
    b.addEventListener('click', onClick);
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
  if (done()) button('Share result', 'action primary', share);
  else button('Submit final answer…', 'action primary', ask('final'), shownCode() === '');
  if (!notesHidden) button(notesLocked ? '🔒 Unlock notes' : '🔓 Lock notes', 'action', toggleNotesLock);
  button(notesHidden ? 'Show notes' : 'Hide notes', 'action', toggleNotesPanel);
  button('Restart', 'action', ask('restart'));
}

function restart() {
  Object.assign(state, fresh());
  clearEntry();
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
        .map((x) => (x === null ? '<td></td>' : `<td class="${x ? 'ok' : 'no'}">${x ? '✓' : '✗'}</td>`))
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
  renderLog();
  renderLevels();
}

async function share() {
  const checks = totalChecks();
  const outcome = solved() ? `🔓 ${checks} checks · ${state.rounds.length} rounds` : `🔒 failed after ${checks} checks`;
  const grid = state.rounds.map((r) => r.results.map((x) => (x === null ? '⬛' : x ? '🟩' : '🟥')).join('')).join('\n');
  const text = `DECRYPT #${puzzle.number} ${DIFFICULTIES[difficulty].label} (${length} digits) ${outcome}\n${grid}`;
  try {
    await navigator.clipboard.writeText(text);
    statusEl.textContent = 'Result copied to clipboard';
  } catch {
    statusEl.textContent = text;
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
  if (e.ctrlKey || e.metaKey || e.altKey) return;
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
  clearEntry();
  confirming = null;
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
      const result = !p || saved?.final == null ? '' : saved.final === p.secret.join('') ? ' ✓' : ' ✗';
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
panesEl.addEventListener(
  'scroll',
  () => {
    const current = Math.round(panesEl.scrollLeft / Math.max(1, panesEl.clientWidth));
    tabs.forEach((tab, i) => tab.setAttribute('aria-selected', String(i === current)));
  },
  { passive: true },
);

buildKeypad();
// Open "How to play" for first-time visitors.
if (!readFlag(SEEN_HELP_KEY)) {
  document.querySelector<HTMLDetailsElement>('.howto')!.open = true;
  writeFlag(SEEN_HELP_KEY, true);
}

selectDifficulty(savedDifficulty());
preloadOtherLevels();
