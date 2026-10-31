import './style.css';
import { civInfo } from './sim/civ';
import { lawText, type LawDraft } from './sim/law';
import { buildReport, mark, type Report } from './sim/report';
import type { World } from './sim/types';
import { outcomeOf } from './sim/vocab';
import { advance, amendLaw, citizenById, createWorld, day, enactLaw, repealLaw, slots, snapshot, step } from './sim/world';
import { MAX_TOKENS, REAL_MS_PER_TICK, TOKEN_MS, loadSave, offlineTicks, refreshTokens, writeSave, type SaveData } from './game/save';
import { Renderer, VIEW_H, VIEW_W } from './ui/render';
import { dayHour, esc } from './ui/format';
import {
  caseHTML,
  casesTabHTML,
  citizenCardHTML,
  civProgress,
  collapseHTML,
  confirmResetHTML,
  editorHTML,
  helpHTML,
  introHTML,
  lawsTabHTML,
  metricsHTML,
  peopleTabHTML,
  presetAt,
  reportHTML,
  settingsTabHTML,
  statsTabHTML,
  type CaseFilter,
  type EditorState,
} from './ui/views';

type Tab = 'laws' | 'cases' | 'people' | 'stats' | 'settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function newSave(name: string, past: SaveData['pastNations'] = [], generation = 1): SaveData {
  const w = createWorld((Date.now() ^ (Math.random() * 1e9)) | 0, name);
  w.generation = generation;
  return { version: w.version, world: w, lastSavedAt: Date.now(), tokens: MAX_TOKENS, tokenAt: Date.now(), speed: 10, archive: [], pastNations: past, seenIntro: false };
}

let save: SaveData = loadSave() ?? newSave('名もなき国');
let w: World = save.world;
let tab: Tab = 'laws';
let caseFilter: CaseFilter = 'all';
let editor: EditorState | null = null;
let modalKind: string | null = null;
let acc = 0;
let lastFrame = performance.now();
let lastEventCount = w.events.length;
let lastTick = w.tick;
let hiddenAt: number | null = null;

const renderer = new Renderer($<HTMLCanvasElement>('view'));

// ───── 放置ぶんの計算 ─────

function catchUp(now: number) {
  const { ticks, capped } = offlineTicks(save.lastSavedAt, now);
  if (ticks <= 0 || w.collapsed) return;
  const m = mark(w);
  advance(w, ticks);
  const r = buildReport(w, m, capped);
  save.archive.push(r);
  if (save.archive.length > 15) save.archive.shift();
  lastEventCount = w.events.length;
  // 12時間（現実12分）以上離れていたらレポートを開く
  if (ticks >= 12 && save.seenIntro) openModal('report', reportHTML(r));
}

// ───── モーダル・トースト ─────

function openModal(kind: string, html: string) {
  modalKind = kind;
  $('modal-body').innerHTML = html;
  $('modal').hidden = false;
}

function closeModal() {
  modalKind = null;
  editor = null;
  $('modal').hidden = true;
  $('modal-body').innerHTML = '';
}

let toastTimer = 0;
function toast(text: string) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 3200);
}

// ───── 画面の更新 ─────

function renderHeader() {
  $('nation-name').textContent = w.nationName;
  $('civ-badge').textContent = `Lv${w.civLevel} ${civInfo(w.civLevel).name}`;
  const hour = w.tick % 24;
  const icon = hour >= 20 || hour <= 4 ? '🌙' : hour >= 18 || hour <= 5 ? '🌆' : '☀';
  const holiday = Math.floor(w.tick / 24) % 7 === 6 ? '・休日' : '';
  $('clock').textContent = `${icon} ${dayHour(w.tick)}${holiday}`;
  $('metrics').innerHTML = metricsHTML(w);
  const p = civProgress(w);
  $('civ-progress').style.width = `${p.pct}%`;
  $('civ-label').textContent = p.label;
  document.querySelectorAll<HTMLButtonElement>('.speed button').forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === save.speed));
}

function renderFeed() {
  const items = w.events.slice(-30).reverse();
  $('feed').innerHTML = items.map((e) => `<li class="${e.score >= 30 ? 'hot' : ''}"><time>${dayHour(e.tick)}</time>${esc(e.text)}</li>`).join('');
}

function tokenWait() {
  return save.tokens >= MAX_TOKENS ? 0 : TOKEN_MS - (Date.now() - save.tokenAt);
}

function renderTab() {
  const body = $('tab-body');
  const scroll = body.scrollTop;
  switch (tab) {
    case 'laws':
      body.innerHTML = lawsTabHTML(w, save.tokens, tokenWait());
      break;
    case 'cases':
      body.innerHTML = casesTabHTML(w, caseFilter, save.archive);
      break;
    case 'people':
      body.innerHTML = peopleTabHTML(w);
      break;
    case 'stats':
      body.innerHTML = statsTabHTML(w);
      break;
    case 'settings':
      if (!body.querySelector('#rename') || document.activeElement?.id !== 'rename') body.innerHTML = settingsTabHTML(w, save.pastNations);
      break;
  }
  body.scrollTop = scroll;
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
}

function renderCitizenCard() {
  const card = $('citizen-card');
  if (renderer.selectedId == null) {
    card.hidden = true;
    return;
  }
  const c = citizenById(w, renderer.selectedId);
  if (!c) {
    renderer.selectedId = null;
    card.hidden = true;
    return;
  }
  card.hidden = false;
  card.innerHTML = citizenCardHTML(c);
}

function renderAll() {
  renderHeader();
  renderFeed();
  renderTab();
  renderCitizenCard();
}

// ───── 立法 ─────

function spendToken(): boolean {
  refreshTokens(save, Date.now());
  if (save.tokens < 1) {
    toast('法案が足りません。少し待つと回復します。');
    return false;
  }
  if (save.tokens >= MAX_TOKENS) save.tokenAt = Date.now();
  save.tokens--;
  return true;
}

function openEditor(id: number | null) {
  const law = id ? w.laws.find((l) => l.id === id) : null;
  const draft: LawDraft = law
    ? { subject: law.subject, condition: law.condition, action: law.action, outcome: law.outcome, amount: law.amount }
    : { subject: 'anyone', condition: 'none', action: 'steal', outcome: 'jail', amount: 3 };
  editor = { editingId: id, draft };
  openModal('editor', editorHTML(w, editor));
}

function rerenderEditor() {
  if (!editor) return;
  const box = document.querySelector('.modal-box')!;
  const st = box.scrollTop;
  $('modal-body').innerHTML = editorHTML(w, editor);
  box.scrollTop = st;
}

function commitEditor() {
  if (!editor) return;
  if (!editor.editingId && w.laws.length >= slots(w)) return toast('条文の枠がいっぱいです。');
  if (!spendToken()) return;
  const d = { ...editor.draft };
  if (!outcomeOf(d.outcome).amount) d.amount = 0;
  if (editor.editingId) {
    amendLaw(w, editor.editingId, d);
    toast(`改正：「${lawText(d)}」`);
  } else {
    enactLaw(w, d);
    toast(`制定：「${lawText(d)}」`);
  }
  closeModal();
  persist();
  renderAll();
}

// ───── 進行 ─────

function persist() {
  save.world = w;
  writeSave(save);
}

function newNation(name?: string) {
  const past = [...save.pastNations];
  past.unshift({
    name: w.nationName,
    days: day(w),
    generation: w.generation,
    cases: w.totals.cases,
    peak: Math.max(...w.history.map((h) => h.population), w.citizens.length),
    end: w.collapsed ? '滅亡' : '神が建て直した',
  });
  save = newSave(name ?? w.nationName, past.slice(0, 20), w.generation + 1);
  save.seenIntro = true;
  w = save.world;
  lastEventCount = w.events.length;
  lastTick = w.tick;
  renderer.selectedId = null;
  persist();
  closeModal();
  renderAll();
}

function onTick() {
  renderer.sync(w);
  const fresh = w.events.slice(lastEventCount);
  lastEventCount = w.events.length;
  for (const e of fresh) if (e.kind === 'civ' || e.kind === 'revolution' || (e.kind === 'lawyer' && e.score >= 60)) toast(e.text.slice(0, 60));
  if (w.collapsed && modalKind !== 'collapse') openModal('collapse', collapseHTML(w));
}

function frame(now: number) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!modalKind || modalKind === 'report' || modalKind === 'help') {
    acc += dt * 1000 * save.speed;
  }
  let stepped = 0;
  while (acc >= REAL_MS_PER_TICK && stepped < 20) {
    acc -= REAL_MS_PER_TICK;
    step(w);
    stepped++;
  }
  if (stepped) {
    acc = Math.min(acc, REAL_MS_PER_TICK);
    onTick();
  }
  renderer.draw(w, dt);
  requestAnimationFrame(frame);
}

// UI更新は1秒ごと（タブの中身を毎フレーム作り直さない）
setInterval(() => {
  refreshTokens(save, Date.now());
  if (w.tick !== lastTick || tab === 'laws') {
    lastTick = w.tick;
    renderHeader();
    renderFeed();
    if (tab !== 'settings') renderTab();
    renderCitizenCard();
  }
}, 1000);

// 定期保存（ページを閉じても続きから放置計算できるように）
setInterval(persist, 10_000);
window.addEventListener('pagehide', persist);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    persist();
  } else if (hiddenAt) {
    hiddenAt = null;
    catchUp(Date.now());
    renderer.sync(w);
    renderAll();
    persist();
  }
});

// ───── 入力 ─────

document.querySelector('.speed')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-speed]');
  if (!b) return;
  save.speed = Number(b.dataset.speed);
  renderHeader();
});

document.querySelector('.tabs')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]');
  if (!b) return;
  tab = b.dataset.tab as Tab;
  $('tab-body').scrollTop = 0;
  renderTab();
});

$('tab-body').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const act = t.closest<HTMLElement>('[data-act]');
  const filter = t.closest<HTMLElement>('[data-filter]');
  const rep = t.closest<HTMLElement>('[data-report]');
  const cit = t.closest<HTMLElement>('[data-citizen]');
  if (filter) {
    caseFilter = filter.dataset.filter as CaseFilter;
    renderTab();
  } else if (rep) {
    const r: Report = save.archive[Number(rep.dataset.report)];
    if (r) openModal('report', reportHTML(r, '過去の帰還レポート'));
  } else if (cit) {
    renderer.selectedId = Number(cit.dataset.citizen);
    renderCitizenCard();
    $('view').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (act) {
    const id = Number(act.dataset.id);
    switch (act.dataset.act) {
      case 'new':
        openEditor(null);
        break;
      case 'amend':
        openEditor(id);
        break;
      case 'repeal': {
        const law = w.laws.find((l) => l.id === id);
        if (law && spendToken()) {
          repealLaw(w, id);
          toast(`廃止：「${lawText(law)}」`);
          persist();
          renderAll();
        }
        break;
      }
      case 'rename': {
        const v = ($('rename') as HTMLInputElement).value.trim();
        if (v) {
          w.nationName = v.slice(0, 16);
          persist();
          renderHeader();
          toast('国の名前を変えました');
        }
        break;
      }
      case 'help':
        openModal('help', helpHTML());
        break;
      case 'reset':
        openModal('confirm', confirmResetHTML());
        break;
    }
  }
});

$('modal').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t === $('modal') && modalKind !== 'intro' && modalKind !== 'collapse') return closeModal();
  const chip = t.closest<HTMLButtonElement>('[data-chip]');
  const preset = t.closest<HTMLElement>('[data-preset]');
  const act = t.closest<HTMLElement>('[data-act]');
  if (chip && editor) {
    const group = chip.dataset.chip as keyof LawDraft;
    (editor.draft as unknown as Record<string, string>)[group] = chip.dataset.val!;
    if (group === 'outcome') {
      const a = outcomeOf(editor.draft.outcome).amount;
      editor.draft.amount = a ? a.def : 0;
    }
    rerenderEditor();
  } else if (preset && editor) {
    editor.draft = presetAt(Number(preset.dataset.preset));
    rerenderEditor();
  } else if (act) {
    switch (act.dataset.act) {
      case 'cancel':
      case 'close':
        closeModal();
        break;
      case 'enact':
        commitEditor();
        break;
      case 'to-laws':
        closeModal();
        tab = 'laws';
        renderTab();
        document.querySelector('.panel')?.scrollIntoView({ behavior: 'smooth' });
        break;
      case 'start': {
        const v = ($('intro-name') as HTMLInputElement).value.trim() || '名もなき国';
        w.nationName = v.slice(0, 16);
        if (w.events[0]) w.events[0].text = `${w.nationName}が建国された。国民${w.citizens.length}人。神（あなた）の法典はまだ白紙である。`;
        save.seenIntro = true;
        save.lastSavedAt = Date.now();
        closeModal();
        persist();
        renderAll();
        break;
      }
      case 'new-nation':
        newNation();
        break;
    }
  }
});

$('modal').addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'amount' && editor) {
    editor.draft.amount = Number(t.value);
    const unit = outcomeOf(editor.draft.outcome).amount?.unit ?? '';
    $('amount-out').textContent = `${t.value}${unit}`;
    $('preview').textContent = lawText(editor.draft);
  }
});

$('citizen-card').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-act="close-card"]')) {
    renderer.selectedId = null;
    renderCitizenCard();
  }
});

$('view').addEventListener('click', (e) => {
  const canvas = e.currentTarget as HTMLCanvasElement;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * VIEW_W;
  const y = ((e.clientY - rect.top) / rect.height) * VIEW_H;
  const c = renderer.pick(w, x, y);
  renderer.selectedId = c ? c.id : null;
  renderCitizenCard();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalKind && modalKind !== 'intro' && modalKind !== 'collapse') closeModal();
});

// ───── 起動 ─────

catchUp(Date.now());
renderer.sync(w);
renderAll();
if (!save.seenIntro) openModal('intro', introHTML());
else if (w.collapsed) openModal('collapse', collapseHTML(w));
persist();
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}

// デバッグ用（コンソールから __game で状態を見られる）
(window as unknown as { __game: unknown }).__game = { get world() { return w; }, snapshot: () => snapshot(w), caseHTML };
