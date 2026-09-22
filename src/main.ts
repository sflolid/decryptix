import { dailyPuzzle, todayKey } from './puzzle';
import type { Digits } from './rules';

const MAX_GUESSES = 6;
const STORAGE_KEY = 'decrypt:state';

interface SavedState {
  day: string;
  guesses: string[];
}

const day = todayKey();
const puzzle = dailyPuzzle(day);
const secret = puzzle.secret.join('');

let guesses: string[] = load();
let current = '';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const rulesEl = $('rules');
const slotsEl = $('slots');
const statusEl = $('status');
const keypadEl = $('keypad');
const historyEl = $('history');

const toDigits = (s: string): Digits => s.split('').map(Number);
const results = (guess: string) => puzzle.rules.map((r) => r.test(toDigits(guess)));
const solved = () => guesses.includes(secret);
const over = () => solved() || guesses.length >= MAX_GUESSES;

function load(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as SavedState | null;
    if (saved?.day === day) return saved.guesses;
  } catch {
    /* storage unavailable: start fresh */
  }
  return [];
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ day, guesses } satisfies SavedState));
  } catch {
    /* ignore */
  }
}

function renderRules() {
  const last = guesses.at(-1);
  const res = last ? results(last) : null;
  rulesEl.innerHTML = '';
  puzzle.rules.forEach((rule, i) => {
    const tile = document.createElement('div');
    tile.className = 'rule' + (res ? (res[i] ? ' pass' : ' fail') : '');
    tile.innerHTML = `<span class="rule-no">${i + 1}</span><span class="rule-text"></span>`;
    tile.querySelector('.rule-text')!.textContent = rule.text;
    rulesEl.append(tile);
  });
}

function renderSlots() {
  slotsEl.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot' + (i === current.length && !over() ? ' active' : '');
    slot.textContent = current[i] ?? '';
    slotsEl.append(slot);
  }
}

function renderHistory() {
  historyEl.innerHTML = '';
  guesses.forEach((g, n) => {
    const row = document.createElement('div');
    row.className = 'guess' + (g === secret ? ' win' : '');
    const dots = results(g)
      .map((ok, i) => `<span class="dot ${ok ? 'pass' : 'fail'}" title="Rule ${i + 1}"></span>`)
      .join('');
    row.innerHTML = `<span class="guess-no">${n + 1}</span><span class="guess-code">${g}</span><span class="dots">${dots}</span>`;
    historyEl.prepend(row);
  });
}

function renderStatus(msg?: string) {
  if (msg) {
    statusEl.textContent = msg;
  } else if (solved()) {
    statusEl.innerHTML = `Decrypted in ${guesses.length}/${MAX_GUESSES}! <button id="share">Share</button>`;
    $('share').addEventListener('click', share);
  } else if (over()) {
    statusEl.innerHTML = `Out of attempts. The code was <strong>${secret}</strong>. <button id="share">Share</button>`;
    $('share').addEventListener('click', share);
  } else {
    statusEl.textContent = `${MAX_GUESSES - guesses.length} attempts left`;
  }
}

function render(msg?: string) {
  renderRules();
  renderSlots();
  renderHistory();
  renderStatus(msg);
  keypadEl.classList.toggle('disabled', over());
}

function press(key: string) {
  if (over()) return;
  if (/^\d$/.test(key) && current.length < 5) current += key;
  else if (key === 'Backspace') current = current.slice(0, -1);
  else if (key === 'Enter') return submit();
  renderSlots();
}

function submit() {
  if (current.length < 5) return render('Enter all 5 digits');
  guesses.push(current);
  current = '';
  save();
  render();
}

async function share() {
  const score = solved() ? guesses.length : 'X';
  const lines = guesses.map((g) => results(g).map((ok) => (ok ? '🟩' : '🟥')).join(''));
  const text = `DECRYPT #${puzzle.number} ${score}/${MAX_GUESSES}\n${lines.join('\n')}`;
  try {
    await navigator.clipboard.writeText(text);
    render('Copied to clipboard');
  } catch {
    render(text);
  }
}

function buildKeypad() {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Backspace', '0', 'Enter'];
  for (const k of keys) {
    const btn = document.createElement('button');
    btn.textContent = k === 'Backspace' ? '⌫' : k === 'Enter' ? 'ENTER' : k;
    btn.className = k.length > 1 ? 'key wide' : 'key';
    btn.setAttribute('aria-label', k);
    btn.addEventListener('click', () => press(k));
    keypadEl.append(btn);
  }
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^\d$/.test(e.key) || e.key === 'Backspace' || e.key === 'Enter') {
    e.preventDefault();
    press(e.key);
  }
});

$('puzzle-no').textContent = `#${puzzle.number}`;
buildKeypad();
render();
