// 各タブとモーダルのHTMLを組み立てる（状態は読むだけ）
import { CIV_LEVELS, civInfo, nextCiv } from '../sim/civ';
import { jobName } from '../sim/court';
import { lawText, sameLaw, type LawDraft } from '../sim/law';
import type { Report } from '../sim/report';
import type { Citizen, DefenseKind, GameEvent, Law, Snapshot, World } from '../sim/types';
import { ACTIONS, CONDITIONS, OUTCOMES, SUBJECTS, SUBJECT_CHIP, outcomeOf } from '../sim/vocab';
import { avgHappiness, population, slots, snapshot } from '../sim/world';
import type { PastNation } from '../game/save';
import { MAX_TOKENS } from '../game/save';
import { dayHour, duration, esc, mmss, num } from './format';

export const HOLE_NAME: Record<DefenseKind, string> = {
  retroactive: '改正前後のすき間',
  repealed: '廃止済みの条文',
  conflict: '他の条文との矛盾',
  condition: '条件の境界があいまい',
  object: '行為の定義があいまい',
  subject: '主語の範囲があいまい',
  vague: '文言のあいまいさ',
};

const HOLE_FIX: Record<DefenseKind, string> = {
  retroactive: '改正はなるべく少なく',
  repealed: '',
  conflict: '同じ行為に報酬を与える条文を見直す',
  condition: '条件を外すと境界の言い逃れがなくなる',
  object: '「リンゴを盗んだ」より「盗みを働いた」のように広い行為にする',
  subject: '主語を「誰でも」に広げる',
  vague: '弁護士が強いほど通りやすい',
};

const ACTIVITY_TEXT: Record<string, string> = {
  sleep: '眠っている',
  work: '働いている',
  leisure: 'おしゃべり中',
  steal_apple: 'リンゴを盗んでいる',
  steal_pear: '梨を盗んでいる（リンゴではない）',
  steal: '盗みを働いている',
  assault: '暴れている',
  blackmarket: '闇市で取引中',
  beg: '物乞い中',
  awake: '眠れずにいる',
  jail: '投獄中',
  court: '裁判所に出廷中',
};

export function lawKind(l: { outcome: Law['outcome'] }) {
  return outcomeOf(l.outcome).kind;
}

// ───── ヘッダー ─────

export function metricsHTML(w: World): string {
  const s = snapshot(w);
  const items: [string, string, boolean][] = [
    ['人口', `${s.population}`, s.population < 15],
    ['国庫', `${num(s.treasury)}G`, s.treasury < 20],
    ['経済', `${num(s.gdp)}`, false],
    ['食料', `${w.foodPrice}G`, w.foodPrice >= 10],
    ['治安', `${s.safety}`, s.safety < 40],
    ['幸福', `${s.happiness}`, s.happiness < 30],
    ['自由', `${s.freedom}`, s.freedom < 40],
    ['地下経済', `${s.underground}%`, s.underground > 40],
  ];
  return items.map(([k, v, warn]) => `<div class="metric${warn ? ' warn' : ''}"><span>${k}</span><b>${v}</b></div>`).join('');
}

export function civProgress(w: World): { pct: number; label: string } {
  const cur = civInfo(w.civLevel);
  const next = nextCiv(w.civLevel);
  if (!next) return { pct: 100, label: `文明Lv${cur.level} ${cur.name}（最高）` };
  const pct = Math.min(100, ((w.civPoints - cur.points) / (next.points - cur.points)) * 100);
  return { pct, label: `文明Lv${cur.level} ${cur.name} → 次は「${next.name}」 ${Math.floor(pct)}%` };
}

// ───── 法典 ─────

export interface EditorState {
  editingId: number | null;
  draft: LawDraft;
}

export function tokensHTML(tokens: number, nextMs: number): string {
  const pens = Array.from({ length: MAX_TOKENS }, (_, i) => (i < tokens ? '✒' : '<span class="empty">✒</span>')).join('');
  return `<div class="tokens">法案 <span class="pen">${pens}</span> ${tokens < MAX_TOKENS ? `次の回復まで ${mmss(nextMs)}` : '満タン'}</div>`;
}

export function lawsTabHTML(w: World, tokens: number, nextMs: number): string {
  const n = slots(w);
  let html = tokensHTML(tokens, nextMs);
  html += `<div class="hint" style="margin-bottom:10px">条文の制定・改正・廃止には法案が1つ必要です（3分で1つ回復）。国民はあなたの法の文字どおりに動きます。</div>`;
  w.laws.forEach((l, i) => {
    const holes = Object.entries(l.holes) as [DefenseKind, number][];
    const holeText = holes.length
      ? `穴：${holes.map(([k, v]) => `${HOLE_NAME[k]}×${v}`).join('、')}<br><span class="hint">対策のヒント：${holes.map(([k]) => HOLE_FIX[k]).filter(Boolean).join('／')}</span>`
      : '';
    html += `<div class="law ${lawKind(l)}">
      <div class="no">第${i + 1}条（${dayHour(l.enactedTick)}制定）</div>
      <div class="text">${esc(lawText(l))}</div>
      <div class="meta">有罪 ${l.convictions}件 ／ 弁護士に破られた ${l.defeats}件</div>
      ${holeText ? `<div class="holes">${holeText}</div>` : ''}
      <div class="actions">
        <button class="btn" data-act="amend" data-id="${l.id}" ${tokens < 1 ? 'disabled' : ''}>改正</button>
        <button class="btn danger" data-act="repeal" data-id="${l.id}" ${tokens < 1 ? 'disabled' : ''}>廃止</button>
      </div>
    </div>`;
  });
  for (let i = w.laws.length; i < n; i++) {
    html += `<button class="empty-slot" data-act="new" ${tokens < 1 ? 'disabled' : ''}>＋ 第${i + 1}条を作る</button>`;
  }
  const next = nextCiv(w.civLevel);
  if (next && next.slots > n) html += `<div class="locked-slot">🔒 文明Lv${next.level}「${next.name}」で条文が${next.slots}つまで増えます</div>`;
  return html;
}

const PRESETS: (LawDraft & { why: string; lv: number })[] = [
  { subject: 'anyone', condition: 'none', action: 'steal', outcome: 'jail', amount: 3, why: '堅実な治安対策', lv: 1 },
  { subject: 'anyone', condition: 'none', action: 'steal_apple', outcome: 'exile', amount: 0, why: '厳罰。でも梨は？', lv: 1 },
  { subject: 'anyone', condition: 'none', action: 'walk', outcome: 'fine', amount: 50, why: '悪法：ほふく前進の国へ', lv: 1 },
  { subject: 'anyone', condition: 'none', action: 'sleep', outcome: 'fine', amount: 100, why: '悪法：不眠国家', lv: 1 },
  { subject: 'farmer', condition: 'none', action: 'harvest', outcome: 'reward', amount: 3, why: '農業振興（国庫に注意）', lv: 1 },
  { subject: 'anyone', condition: 'night', action: 'work', outcome: 'fine', amount: 100, why: 'ブラック労働の抑止…夜警は？', lv: 1 },
  { subject: 'merchant', condition: 'none', action: 'trade', outcome: 'tax', amount: 20, why: '国庫の財源に', lv: 2 },
  { subject: 'anyone', condition: 'none', action: 'trade', outcome: 'tax', amount: 100, why: '悪法：地下経済が爆誕', lv: 2 },
  { subject: 'anyone', condition: 'none', action: 'assault', outcome: 'jail', amount: 10, why: '暴力に厳しく', lv: 2 },
  { subject: 'anyone', condition: 'none', action: 'sue', outcome: 'reward', amount: 5, why: '悪法：訴訟社会へ', lv: 3 },
  { subject: 'lawyer', condition: 'none', action: 'work', outcome: 'tax', amount: 50, why: '弁護士への逆襲', lv: 3 },
  { subject: 'anyone', condition: 'none', action: 'speak', outcome: 'jail', amount: 1, why: '悪法：沈黙の国', lv: 4 },
  { subject: 'noble', condition: 'none', action: 'work', outcome: 'tax', amount: 30, why: '富裕税', lv: 4 },
  { subject: 'foreigner', condition: 'none', action: 'immigrate', outcome: 'reward', amount: 20, why: '移民歓迎', lv: 5 },
];

export function editorHTML(w: World, ed: EditorState): string {
  const lv = w.civLevel;
  const d = ed.draft;
  const chip = (group: string, id: string, label: string, unlock: number, hint?: string) => {
    const locked = unlock > lv;
    const on = (d as unknown as Record<string, string>)[group] === id;
    return `<button class="chip${on ? ' on' : ''}" data-chip="${group}" data-val="${id}" ${locked ? 'disabled' : ''} title="${esc(hint ?? '')}">${label}${locked ? ` <small>🔒Lv${unlock}</small>` : hint && !on ? ` <small>${esc(hint)}</small>` : ''}</button>`;
  };
  const oc = outcomeOf(d.outcome);
  const dup = w.laws.some((l) => l.id !== ed.editingId && sameLaw(l, d));
  const presets = PRESETS.filter((p) => p.lv <= lv);
  return `<div class="editor">
    <h2>${ed.editingId ? '条文を改正する' : '新しい条文を作る'}</h2>
    <div class="sub">「主語＋条件＋行動＋結果」を組み合わせてください。意味が通らない条文もあえて作れます。</div>
    <div class="preview" id="preview">${esc(lawText(d))}</div>
    <div class="step"><div class="step-label">① 条件（いつ・どこで）</div><div class="chips">
      ${CONDITIONS.map((c) => chip('condition', c.id, c.id === 'none' ? '条件なし' : c.label, c.unlock, c.id === 'none' ? undefined : c.hint)).join('')}
    </div></div>
    <div class="step"><div class="step-label">② 行動（何をしたら）</div><div class="chips">
      ${ACTIONS.map((a) => chip('action', a.id, a.label, a.unlock)).join('')}
    </div></div>
    <div class="step"><div class="step-label">③ 主語（誰が）</div><div class="chips">
      ${SUBJECTS.map((s) => chip('subject', s.id, SUBJECT_CHIP[s.id], s.unlock, s.hint)).join('')}
    </div></div>
    <div class="step"><div class="step-label">④ 結果（どうなる）</div><div class="chips">
      ${OUTCOMES.map((o) => chip('outcome', o.id, o.label, o.unlock)).join('')}
    </div>
    ${oc.amount ? `<div class="range-row"><input type="range" id="amount" min="${oc.amount.min}" max="${oc.amount.max}" step="${oc.amount.step}" value="${d.amount}"><output id="amount-out">${d.amount}${oc.amount.unit}</output></div>` : ''}
    </div>
    ${dup ? '<div class="hint" style="color:var(--bad)">同じ条文がすでにあります。</div>' : ''}
    ${!ed.editingId && presets.length ? `<div class="section-title">ひらめき（タップで入力）</div><div class="presets">${presets.map((p) => `<button class="preset" data-preset="${PRESETS.indexOf(p)}">${esc(lawText(p))}<br><span class="hint">${esc(p.why)}</span></button>`).join('')}</div>` : ''}
    <div class="modal-actions">
      <button class="btn" data-act="cancel">やめる</button>
      <button class="btn primary" data-act="enact" ${dup ? 'disabled' : ''}>${ed.editingId ? '改正する' : '制定する'}（法案1）</button>
    </div>
  </div>`;
}

export function presetAt(i: number): LawDraft {
  const { subject, condition, action, outcome, amount } = PRESETS[i];
  return { subject, condition, action, outcome, amount };
}

// ───── 判例集 ─────

export type CaseFilter = 'all' | 'verdict' | 'incident' | 'news';

export function casesTabHTML(w: World, filter: CaseFilter, archive: Report[]): string {
  let html = '';
  if (archive.length) {
    html += `<div class="section-title">帰還レポート</div>`;
    html += [...archive]
      .reverse()
      .slice(0, 8)
      .map((r, i) => `<button class="report-link" data-report="${archive.length - 1 - i}">📜 ${dayHour(r.fromTick)}〜${dayHour(r.toTick)}（${duration(r.hours)}） 判例${r.counts.cases}件</button>`)
      .join('');
  }
  const f = (k: CaseFilter, label: string) => `<button class="chip${filter === k ? ' on' : ''}" data-filter="${k}">${label}</button>`;
  html += `<div class="section-title">記録</div><div class="filters">${f('all', 'すべて')}${f('verdict', '判例')}${f('incident', '事件')}${f('news', '号外')}</div>`;
  let items: { tick: number; html: string }[] = [];
  if (filter === 'news') {
    items = w.news.map((n) => ({ tick: n.tick, html: `<div class="news">${esc(n.text)}</div>` }));
  } else {
    const evs = w.events.filter((e) => {
      if (filter === 'verdict') return e.kind === 'verdict' || e.kind === 'lawsuit';
      if (filter === 'incident') return e.kind !== 'verdict' && e.kind !== 'lawsuit' && e.kind !== 'law';
      return true;
    });
    items = evs.map((e) => ({ tick: e.tick, html: caseHTML(e) }));
    if (filter === 'all') items.push(...w.news.map((n) => ({ tick: n.tick, html: `<div class="news">${esc(n.text)}</div>` })));
  }
  items.sort((a, b) => b.tick - a.tick);
  html += items.slice(0, 60).map((i) => i.html).join('') || '<div class="hint">まだ記録はありません。条文を作って、しばらく放置してみましょう。</div>';
  return html;
}

export function caseHTML(e: GameEvent): string {
  return `<div class="case${e.score >= 40 ? ' big' : ''}"><time>${dayHour(e.tick)}</time>${esc(e.text)}</div>`;
}

// ───── 国民 ─────

const JOB_COLORS: Record<string, string> = { farmer: '#8bc34a', merchant: '#b388ff', guard: '#42a5f5', lawyer: '#eceff1', unemployed: '#a1887f' };

export function peopleTabHTML(w: World): string {
  const pop = population(w);
  const jobs = ['farmer', 'merchant', 'guard', 'lawyer', 'unemployed'] as const;
  const counts = jobs.map((j) => w.citizens.filter((c) => c.job === j).length);
  let html = `<div class="section-title">職業（${pop}人）</div>`;
  html += `<div class="jobs">${jobs.map((j, i) => (counts[i] ? `<div style="flex:${counts[i]};background:${JOB_COLORS[j]}"></div>` : '')).join('')}</div>`;
  html += `<div class="legend">${jobs.map((j, i) => `<span><i style="background:${JOB_COLORS[j]}"></i>${jobName(j)} ${counts[i]}</span>`).join('')}</div>`;
  const jailed = w.citizens.filter((c) => c.status === 'jailed').length;
  const foreigners = w.citizens.filter((c) => c.foreigner).length;
  const crawling = w.citizens.filter((c) => c.crawling).length;
  html += `<div class="hint" style="margin-top:6px">投獄中 ${jailed}人 ／ 移民 ${foreigners}人 ／ 平均幸福度 ${Math.round(avgHappiness(w))}${crawling ? ` ／ ほふく前進中 ${crawling}人` : ''}</div>`;

  const table = (title: string, list: Citizen[], col: string, val: (c: Citizen) => string) =>
    list.length
      ? `<div class="section-title">${title}</div><table class="table"><tr><th>名前</th><th>職業</th><th class="num">${col}</th></tr>${list
          .map((c) => `<tr data-citizen="${c.id}"><td>${esc(c.name)}</td><td>${jobName(c.job)}</td><td class="num">${val(c)}</td></tr>`)
          .join('')}</table>`
      : '';
  const top = (key: (c: Citizen) => number, n = 3) => [...w.citizens].filter((c) => key(c) > 0).sort((a, b) => key(b) - key(a)).slice(0, n);
  html += table('💰 大富豪', top((c) => c.money), '資産', (c) => `${num(c.money)}G`);
  html += table('⚖ 敏腕弁護士', top((c) => (c.job === 'lawyer' ? c.wins + 0.01 : 0)), '勝訴', (c) => `${c.wins}`);
  html += table('🕳 抜け穴の達人', top((c) => c.loopholeGain), '抜け穴で得た額', (c) => `${num(c.loopholeGain)}G`);
  html += table('🚨 前科王', top((c) => c.arrests), '逮捕', (c) => `${c.arrests}回`);
  html += `<div class="hint" style="margin-top:10px">国土ビューの国民をタップすると詳しく見られます。</div>`;
  return html;
}

export function citizenCardHTML(c: Citizen): string {
  return `<button class="close" data-act="close-card" aria-label="閉じる">×</button>
  <h4>${esc(c.name)} <span class="hint">${c.foreigner ? '移民の' : ''}${jobName(c.job)}${c.formerJob && c.formerJob !== c.job ? `（元${jobName(c.formerJob)}）` : ''}</span></h4>
  <div style="margin-bottom:4px">${ACTIVITY_TEXT[c.activity] ?? ''}${c.crawling ? '（ほふく前進）' : ''}${c.silent ? '（筆談中）' : ''}${c.insomnia > 3 ? '（寝不足）' : ''}</div>
  <div class="stat-grid">
    <span>所持金 <b>${Math.round(c.money)}G</b></span><span>幸福 <b>${Math.round(c.happiness)}</b></span><span>空腹 <b>${Math.round(c.hunger)}</b></span>
    <span>遵法 <b>${c.lawfulness}</b></span><span>強欲 <b>${c.greed}</b></span><span>恐れ <b>${Math.round(c.fear)}</b></span>
    <span>知性 <b>${c.intelligence}</b></span><span>逮捕 <b>${c.arrests}</b></span><span>${c.job === 'lawyer' ? `勝訴 <b>${c.wins}</b>` : `抜け穴 <b>${Math.round(c.loopholeGain)}G</b>`}</span>
  </div>`;
}

// ───── 統計 ─────

function sparkline(values: number[], color: string): string {
  if (values.length < 2) return '<svg viewBox="0 0 100 30"></svg>';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(2)},${(28 - ((v - min) / span) * 26).toFixed(2)}`).join(' ');
  return `<svg viewBox="0 0 100 30" preserveAspectRatio="none"><polyline fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" points="${pts}"/></svg>`;
}

export function statsTabHTML(w: World): string {
  const h = w.history.slice(-60);
  const cur = snapshot(w);
  const rows: [keyof Snapshot, string, string, string][] = [
    ['population', '人口', '#7dd3fc', '人'],
    ['gdp', '経済（1日の生産）', '#ffcf5a', ''],
    ['treasury', '国庫', '#c4b5fd', 'G'],
    ['happiness', '幸福度', '#7ee08a', ''],
    ['safety', '治安', '#93c5fd', ''],
    ['freedom', '自由度', '#f9a8d4', ''],
    ['underground', '地下経済', '#fca5a5', '%'],
  ];
  let html = `<div class="hint" style="margin-bottom:8px">直近${h.length}日の推移</div>`;
  for (const [k, label, color, unit] of rows) {
    html += `<div class="chart"><div class="chart-head"><span>${label}</span><b>${num(cur[k] as number)}${unit}</b></div>${sparkline(h.map((s) => s[k] as number), color)}</div>`;
  }
  const t = w.totals;
  html += `<div class="section-title">建国からの累計</div><div class="hint">裁判 ${t.cases}件（うち無罪 ${t.acquittals}件）／ 誕生 ${t.born}人 ／ 死亡 ${t.died}人 ／ 追放 ${t.exiled}人 ／ 革命 ${t.revolutions}回</div>`;
  html += `<div class="section-title">文明レベル</div><table class="table">${CIV_LEVELS.map((c) => `<tr><td>${c.level <= w.civLevel ? '✅' : '🔒'} Lv${c.level} ${c.name}</td><td class="hint">${c.unlocks}</td></tr>`).join('')}</table>`;
  return html;
}

// ───── 設定 ─────

export function settingsTabHTML(w: World, past: PastNation[]): string {
  return `<div class="section-title">国の名前</div>
  <div style="display:flex;gap:6px"><input type="text" id="rename" maxlength="16" value="${esc(w.nationName)}"><button class="btn" data-act="rename">変更</button></div>
  <div class="section-title">遊び方</div>
  <button class="btn" data-act="help">遊び方を見る</button>
  <div class="section-title">やり直し</div>
  <div class="hint" style="margin-bottom:6px">今の国を歴史に残して、新しい国を建てます。</div>
  <button class="btn danger" data-act="reset">建国をやり直す</button>
  ${past.length ? `<div class="section-title">歴史に残る国々</div><table class="table">${past.map((p) => `<tr><td>第${p.generation}代 ${esc(p.name)}</td><td class="num">${p.days}日</td><td class="hint">${esc(p.end)}</td></tr>`).join('')}</table>` : ''}
  <div class="section-title">このゲームについて</div>
  <div class="hint">放置法治国家 v1.0 ／ データはこのブラウザだけに保存されます。ホーム画面に追加するとアプリのように遊べます（オフライン対応）。</div>`;
}

// ───── モーダル ─────

export function introHTML(): string {
  return `<h2>放置法治国家へようこそ</h2>
  <div class="sub">あなたは新しい国の「立法機関（あるいは神）」です。</div>
  <p>あなたにできるのは<b>法律を書くことだけ</b>。国民を直接動かすことはできません。条文は「主語＋条件＋行動＋結果」の組み合わせで作ります。</p>
  <p>法を決めたら、あとは国民まかせ。アプリを閉じている間も（最大8時間ぶん）国民は働き、盗み、捕まり、裁判を受けます。戻ってくると<b>判例レポート</b>が待っています。</p>
  <p>極端な法律を作ると、国民は文字どおりに従って<b>おかしな行動</b>を始めます。文明が進むと<b>弁護士</b>が現れ、あなたの法の穴を突いてきます。</p>
  <div class="section-title">国の名前</div>
  <input type="text" id="intro-name" maxlength="16" value="名もなき国">
  <div class="modal-actions"><button class="btn primary" data-act="start">建国する</button></div>`;
}

export function helpHTML(): string {
  return `<h2>遊び方</h2>
  <p><b>1. 条文を作る</b>：法典タブの「＋」から、条件・行動・主語・結果を選びます。法案（✒）を1つ使います。</p>
  <p><b>2. 眺める・放置する</b>：国民は「得か損か」を計算して行動します。罰が重くても見つかりにくければ破るし、報酬が出るなら変なことでもします。</p>
  <p><b>3. 判例を読む</b>：戻ってくると放置中の事件簿が表示されます。抜け穴を突いた悪人や理不尽な判決を見て、次の改正に活かしましょう。</p>
  <p><b>文明レベル</b>：経済と人口が育つと上がり、語彙と条文の枠が増えます。Lv3で裁判所と弁護士が登場します。</p>
  <p><b>気をつけること</b>：国庫が空だと衛兵の給料も報酬も払えません。幸福度が低い日が続くと暴動、さらに続くと革命で法典が燃やされます。</p>
  <div class="modal-actions"><button class="btn primary" data-act="close">わかった</button></div>`;
}

function delta(label: string, a: number, b: number, unit = '', higherIsGood = true): string {
  const d = Math.round(b - a);
  const cls = d === 0 ? '' : (d > 0) === higherIsGood ? 'up' : 'down';
  return `<div class="delta">${label}<b>${num(b)}${unit}</b><span class="${cls}">${d > 0 ? '▲' : d < 0 ? '▼' : '±'}${num(Math.abs(d))}</span></div>`;
}

export function reportHTML(r: Report, title?: string): string {
  const a = r.before;
  const b = r.after;
  return `<h2>${title ?? `神が不在だった${duration(r.hours)}の出来事`}</h2>
  <div class="sub">${dayHour(r.fromTick)} 〜 ${dayHour(r.toTick)}${r.capped ? '（8時間を超えた分は、国民が神の不在に慣れたため記録されていません）' : ''}</div>
  <div class="delta-grid">
    ${delta('人口', a.population, b.population)}
    ${delta('経済', a.gdp, b.gdp)}
    ${delta('国庫', a.treasury, b.treasury, 'G')}
    ${delta('治安', a.safety, b.safety)}
    ${delta('幸福度', a.happiness, b.happiness)}
    ${delta('自由度', a.freedom, b.freedom)}
    ${delta('地下経済', a.underground, b.underground, '%', false)}
    ${delta('文明Lv', a.civLevel, b.civLevel)}
  </div>
  <div class="hint" style="margin-top:6px">裁判 ${r.counts.cases}件（無罪 ${r.counts.acquittals}件）／ 誕生 ${r.counts.born}人 ／ 死亡 ${r.counts.died}人 ／ 追放 ${r.counts.exiled}人</div>
  ${r.news.length ? `<div class="section-title">号外</div>${r.news.map((n) => `<div class="news">${esc(n.text)}</div>`).join('')}` : ''}
  <div class="section-title">注目の判例・事件</div>
  ${r.highlights.length ? r.highlights.map(caseHTML).join('') : '<div class="hint">特に目立った事件はなかった。平和な（あるいは退屈な）日々だった。</div>'}
  <div class="modal-actions"><button class="btn" data-act="close">閉じる</button><button class="btn primary" data-act="to-laws">法典を見直す</button></div>`;
}

export function collapseHTML(w: World): string {
  return `<h2>${esc(w.nationName)}は滅亡しました</h2>
  <div class="sub">建国から${Math.floor(w.tick / 24) + 1}日目。最後の国民がいなくなりました。</div>
  <p>裁判 ${w.totals.cases}件、追放 ${w.totals.exiled}人、死亡 ${w.totals.died}人、革命 ${w.totals.revolutions}回。法典には${w.laws.length}つの条文が残されていました。</p>
  <div class="modal-actions"><button class="btn primary" data-act="new-nation">新しい国を建てる</button></div>`;
}

export function confirmResetHTML(): string {
  return `<h2>建国をやり直しますか？</h2>
  <div class="sub">今の国は「歴史に残る国々」に記録され、新しい国が始まります。この操作は取り消せません。</div>
  <div class="modal-actions"><button class="btn" data-act="close">やめる</button><button class="btn danger" data-act="new-nation">やり直す</button></div>`;
}

export { sameLaw };
