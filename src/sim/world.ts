// シミュレーション本体。描画から独立した純粋なロジック（乱数は World 内のシードのみ）。
import { bell, chance, nextRandom, pick, randInt } from './rng';
import { civInfo, nextCiv } from './civ';
import { judge, jobName } from './court';
import { freedomIndex, isPenalty, lawApplies, lawText, outcomeText, penaltyValue, timeContext, type LawDraft, type TimeContext } from './law';
import { makeName } from './names';
import type { Activity, Citizen, DayStats, GameEvent, Job, Law, PendingCase, Place, Snapshot, World } from './types';
import { CONTINUOUS_ACTIONS, CRIME_ACTIONS, type ActionId } from './vocab';
import { dailyNews } from './news';

export const SAVE_VERSION = 1;
export const MAX_POPULATION = 220;
const BASE_TAX = 0.1;

export function emptyStats(): DayStats {
  return {
    gdp: 0, trade: 0, underground: 0, crimes: 0, arrests: 0, nightCrimes: 0, births: 0, immigrants: 0, emigrants: 0,
    exiles: 0, deaths: 0, lawsuits: 0, taxes: 0, fines: 0, rewards: 0, harvest: 0, crawlTicks: 0, insomniaTicks: 0,
    silentTicks: 0, activeTicks: 0, loopholes: 0, unpaidRewards: 0,
  };
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function newCitizen(w: World, job: Job, opts: Partial<Citizen> = {}): Citizen {
  const c: Citizen = {
    id: w.nextCitizenId++,
    name: makeName(w),
    job,
    formerJob: null,
    jobSince: w.tick - 200,
    money: Math.round(bell(w, 30, 20)),
    hunger: randInt(w, 0, 30),
    fatigue: randInt(w, 0, 40),
    happiness: Math.round(bell(w, 60, 15)),
    lawfulness: Math.round(clamp(bell(w, 55, 45), 0, 100)),
    greed: Math.round(clamp(bell(w, 40, 40), 0, 100)),
    fear: Math.round(clamp(bell(w, 50, 45), 0, 100)),
    intelligence: Math.round(clamp(bell(w, 50, 50), 0, 100)),
    foreigner: false,
    status: 'free',
    jailUntil: 0,
    activity: 'sleep',
    place: 'home',
    crawling: false,
    silent: false,
    insomnia: 0,
    starving: 0,
    arrests: 0,
    wins: 0,
    loopholeGain: 0,
    victimToday: false,
    settledToday: [],
    isNoble: false,
    isPoor: false,
    wealthRank: 0,
    ...opts,
  };
  return c;
}

export function createWorld(seed: number, nationName = '名もなき国'): World {
  const w: World = {
    version: SAVE_VERSION,
    nationName,
    rng: seed | 0,
    tick: 6,
    citizens: [],
    nextCitizenId: 1,
    laws: [],
    nextLawId: 1,
    treasury: 400,
    food: 260,
    foodPrice: 4,
    marketPot: 60,
    civLevel: 1,
    civPoints: 0,
    today: emptyStats(),
    yesterday: emptyStats(),
    history: [],
    events: [],
    news: [],
    caseCounter: 0,
    courtQueue: [],
    milestones: [],
    lowHappyDays: 0,
    safety: 80,
    totals: { born: 0, died: 0, exiled: 0, cases: 0, acquittals: 0, revolutions: 0 },
    collapsed: false,
    generation: 1,
  };
  const jobs: [Job, number][] = [['farmer', 22], ['merchant', 9], ['guard', 6], ['unemployed', 13]];
  for (const [job, n] of jobs) for (let i = 0; i < n; i++) w.citizens.push(newCitizen(w, job));
  updateWealth(w);
  w.history.push(snapshot(w));
  logEvent(w, 'misc', `${nationName}が建国された。国民${w.citizens.length}人。神（あなた）の法典はまだ白紙である。`, 5);
  return w;
}

// ───────── 指標 ─────────

export function population(w: World) {
  return w.citizens.length;
}

export function avgHappiness(w: World) {
  if (w.citizens.length === 0) return 0;
  return w.citizens.reduce((s, c) => s + c.happiness, 0) / w.citizens.length;
}

export function undergroundShare(s: DayStats) {
  const all = s.trade + s.underground;
  return all === 0 ? 0 : Math.round((s.underground / all) * 100);
}

export function snapshot(w: World): Snapshot {
  const s = w.tick % 24 === 0 ? w.yesterday : mergeForView(w);
  return {
    day: day(w),
    population: population(w),
    gdp: Math.round(s.gdp),
    treasury: Math.round(w.treasury),
    safety: Math.round(w.safety),
    happiness: Math.round(avgHappiness(w)),
    freedom: freedomIndex(w.laws),
    underground: undergroundShare(s),
    food: Math.round(w.food),
    civLevel: w.civLevel,
  };
}

/** 1日の途中でも見やすいように、昨日の値を基準にする */
function mergeForView(w: World): DayStats {
  return w.yesterday.gdp > 0 ? w.yesterday : w.today;
}

export function day(w: World) {
  return Math.floor(w.tick / 24) + 1;
}

export function slots(w: World) {
  return civInfo(w.civLevel).slots;
}

export function logEvent(w: World, kind: GameEvent['kind'], text: string, score: number, extra: Partial<GameEvent> = {}) {
  w.events.push({ tick: w.tick, kind, text, score, ...extra });
  if (w.events.length > 700) w.events.splice(0, w.events.length - 700);
}

// ───────── 立法 ─────────

export function enactLaw(w: World, d: LawDraft): Law {
  const law: Law = { ...d, id: w.nextLawId++, enactedTick: w.tick, convictions: 0, defeats: 0, holes: {} };
  w.laws.push(law);
  logEvent(w, 'law', `新法制定：「${lawText(law)}」`, 3);
  return law;
}

export function amendLaw(w: World, id: number, d: LawDraft): Law | null {
  const law = w.laws.find((l) => l.id === id);
  if (!law) return null;
  const before = lawText(law);
  Object.assign(law, d, { enactedTick: w.tick, convictions: 0, defeats: 0, holes: {} });
  logEvent(w, 'law', `法改正：「${before}」→「${lawText(law)}」`, 3);
  return law;
}

export function repealLaw(w: World, id: number) {
  const i = w.laws.findIndex((l) => l.id === id);
  if (i < 0) return;
  const [law] = w.laws.splice(i, 1);
  logEvent(w, 'law', `法廃止：「${lawText(law)}」`, 3);
}

// ───────── 1時間ぶんの進行 ─────────

interface Ctx {
  t: TimeContext;
  pCrime: number;
  pPublic: number;
}

interface Option {
  act: Activity;
  tags: ActionId[];
  place: Place;
  base: number;
  income: number;
}

const WORK_TAGS: Record<Job, ActionId[]> = {
  farmer: ['work', 'harvest'],
  merchant: ['work', 'trade'],
  guard: ['work'],
  lawyer: ['work'],
  unemployed: [],
};
const WORK_PLACE: Record<Job, Place> = { farmer: 'field', merchant: 'market', guard: 'street', lawyer: 'court', unemployed: 'plaza' };

function personalHour(c: Citizen, hour: number) {
  // 衛兵の3人に1人は夜勤
  return c.job === 'guard' && c.id % 3 === 0 ? (hour + 12) % 24 : hour;
}

function isSleepTime(ph: number) {
  return ph >= 23 || ph <= 5;
}
function isWorkTime(ph: number) {
  return ph >= 7 && ph <= 18;
}

function expectedIncome(w: World, c: Citizen): number {
  switch (c.job) {
    case 'farmer':
      return 1.3 * w.foodPrice * 0.8;
    case 'merchant':
      return 4;
    case 'guard':
      return w.treasury > 2 ? 1.3 : 0;
    case 'lawyer':
      return 1.2;
    default:
      return 0;
  }
}

/** 法による期待コスト（効用単位）。マイナスなら得（報酬）。 */
function legalCost(w: World, c: Citizen, tags: readonly ActionId[], place: Place, ctx: Ctx, income: number): number {
  let cost = 0;
  const desperate = c.hunger > 85 ? 0.3 : 1;
  for (const law of w.laws) {
    if (!lawApplies(law, c, tags, ctx.t, place)) continue;
    const continuous = CONTINUOUS_ACTIONS.has(law.action);
    if (continuous && c.settledToday.includes(law.id) && law.outcome !== 'tax') continue;
    const p = CRIME_ACTIONS.has(law.action) ? ctx.pCrime : ctx.pPublic * (continuous ? 0.35 : 1);
    switch (law.outcome) {
      case 'fine':
      case 'jail':
      case 'exile':
      case 'death': {
        const perceived = p * (0.15 + c.fear / 120);
        // 犯罪の後ろめたさは行動の基本値に含まれているので、それ以外の行為にだけ遵法コストを足す
        const moral = CRIME_ACTIONS.has(law.action) ? 0 : c.lawfulness / 20;
        cost += (perceived * 2 * Math.sqrt(penaltyValue(law)) + moral) * desperate;
        break;
      }
      case 'ban':
        cost += c.lawfulness / 20;
        break;
      case 'reward': {
        const payable = w.treasury >= law.amount ? law.amount : 0;
        cost -= Math.sqrt(payable) * (continuous ? 0.5 : 1.2);
        break;
      }
      case 'tax': {
        const base = income > 0 ? income : 0.4;
        cost += base * (law.amount / 100) * 0.5 + (law.amount >= 90 ? 1.5 : 0);
        break;
      }
    }
  }
  return cost;
}

function options(w: World, c: Citizen, ctx: Ctx): Option[] {
  const ph = personalHour(c, ctx.t.hour);
  const sleepTime = isSleepTime(ph);
  const workTime = isWorkTime(ph);
  const evening = ph >= 19 && ph <= 22;
  const o: Option[] = [];
  o.push({ act: 'sleep', tags: ['sleep'], place: 'home', base: c.fatigue / 12 + (sleepTime ? 3.2 : -3), income: 0 });
  o.push({ act: 'awake', tags: [], place: 'home', base: sleepTime ? -c.fatigue / 25 : 0.2, income: 0 });

  if (c.job !== 'unemployed') {
    const income = expectedIncome(w, c);
    let base = workTime ? 4 : evening ? 0.3 : -3;
    if (ctx.t.holiday && c.job !== 'guard') base -= 2.5;
    if (c.job === 'guard' && w.treasury <= 2) base -= 2;
    o.push({ act: 'work', tags: WORK_TAGS[c.job], place: WORK_PLACE[c.job], base: base + income * 0.5, income });
    if (c.job === 'merchant' && w.civLevel >= 2) {
      o.push({ act: 'blackmarket', tags: [], place: 'alley', base: base + income * 0.35 - 1.2 - c.lawfulness / 50, income: income * 0.7 });
    }
  } else {
    o.push({ act: 'beg', tags: [], place: 'plaza', base: workTime ? 1.4 + c.hunger / 40 : -2, income: 0.3 });
    if (c.greed > 60 && w.civLevel >= 2) {
      o.push({ act: 'blackmarket', tags: [], place: 'alley', base: (workTime ? 1 : -1) + c.greed / 60 - c.lawfulness / 40, income: 2 });
    }
  }

  o.push({ act: 'leisure', tags: ['speak'], place: 'plaza', base: 1.2 + (evening ? 2.8 : 0) + (100 - c.happiness) / 60 - (sleepTime ? 3 : 0), income: 0 });

  const hungry = c.hunger / 15 + (c.money < w.foodPrice ? 2.5 : 0);
  const crimeBase = 0.6 - c.lawfulness / 25 + c.greed / 70 + (100 - c.happiness) / 60;
  o.push({ act: 'steal_apple', tags: ['steal_apple', 'steal'], place: chance(w, 0.6) ? 'market' : 'field', base: hungry + crimeBase - 1.4, income: 0 });
  if (c.intelligence > 62) {
    o.push({ act: 'steal_pear', tags: ['steal'], place: chance(w, 0.6) ? 'market' : 'field', base: hungry + crimeBase - 1.6, income: 0 });
  }
  o.push({ act: 'steal', tags: ['steal'], place: chance(w, 0.5) ? 'street' : 'market', base: c.greed / 25 + (c.money < 10 ? 1.5 : 0) + crimeBase - 1.2, income: 4 });
  if (w.civLevel >= 2 || c.happiness < 20) {
    o.push({ act: 'assault', tags: ['assault'], place: 'street', base: (100 - c.happiness) / 30 - c.lawfulness / 15 - 2.6, income: 0 });
  }
  return o;
}

function choose(w: World, c: Citizen, ctx: Ctx): { opt: Option; crawl: boolean; silent: boolean; skippedApple: boolean } {
  const opts = options(w, c, ctx);
  const impulse = c.lawfulness < 45 && chance(w, 0.015);
  // 歩くことのコスト → ほふく前進
  const walkCost = impulse ? 0 : legalCost(w, c, ['walk'], 'street', ctx, 0);
  const crawl = walkCost > 0.9;
  const speakCost = impulse ? 0 : legalCost(w, c, ['speak'], 'plaza', ctx, 0);
  const silent = speakCost > 0.8;

  let best: Option = opts[0];
  let bestU = -Infinity;
  let appleCost = 0;
  let pearPicked = false;
  for (const op of opts) {
    let tags = op.tags;
    if (op.act === 'leisure' && silent) tags = [];
    let u = op.base + nextRandom(w) * 2.2;
    // 魔が差した：罰を忘れて犯罪に手を出す（リンゴが一番手軽）
    if (impulse) u += op.act === 'steal_apple' ? 5 : op.act === 'steal' || op.act === 'steal_pear' ? 3 : 0;
    if (!impulse) u -= legalCost(w, c, tags, op.place, ctx, op.income);
    if (op.act !== 'sleep' && op.act !== 'awake') u -= crawl ? 0.6 : impulse ? 0 : walkCost;
    if (op.act === 'leisure' && silent) u -= 0.8;
    if (op.act === 'steal_apple') appleCost = legalCost(w, c, ['steal_apple'], op.place, ctx, 0);
    if (u > bestU) {
      bestU = u;
      best = op;
      pearPicked = op.act === 'steal_pear';
    }
  }
  return { opt: best, crawl: crawl && best.act !== 'sleep' && best.act !== 'awake', silent, skippedApple: pearPicked && appleCost > 0.5 };
}

export function step(w: World) {
  if (w.collapsed) return;
  w.tick++;
  const t = timeContext(w.tick);
  if (t.hour === 0) dailyUpdate(w);
  if (w.collapsed) return;

  const pop = w.citizens.length;
  const onDuty = w.citizens.filter((c) => c.job === 'guard' && c.activity === 'work').length;
  const ratio = onDuty / Math.max(1, pop);
  const ctx: Ctx = {
    t,
    pCrime: clamp(0.04 + ratio * 5, 0, 0.85) * (t.night ? 0.6 : 1),
    pPublic: clamp(0.06 + ratio * 3.5, 0, 0.6) * (t.night ? 0.7 : 1),
  };

  for (const c of [...w.citizens]) {
    if (!w.citizens.includes(c)) continue;
    if (c.status === 'jailed') {
      if (w.tick >= c.jailUntil) {
        c.status = 'free';
        c.happiness = clamp(c.happiness - 5, 0, 100);
      } else {
        c.activity = 'jail';
        c.place = 'jail';
        c.hunger = Math.min(c.hunger, 45);
        w.treasury -= 0.08;
        continue;
      }
    }
    if (c.activity === 'court' && chance(w, 0.6)) {
      c.hunger += 1.2;
      continue;
    }
    actCitizen(w, c, ctx);
  }

  if (t.hour === 7 || t.hour === 12 || t.hour === 19) meals(w);
  if (t.hour === 17 && w.civLevel >= 3) holdCourt(w);
}

function actCitizen(w: World, c: Citizen, ctx: Ctx) {
  const { opt, crawl, silent, skippedApple } = choose(w, c, ctx);
  const ph = personalHour(c, ctx.t.hour);
  c.activity = opt.act;
  c.place = opt.place;
  c.crawling = crawl;
  c.silent = silent && opt.act === 'leisure';
  const asleep = opt.act === 'sleep';
  c.hunger = Math.min(100, c.hunger + (asleep ? 0.6 : 1.3));
  c.fatigue = clamp(c.fatigue + (asleep ? -14 : 3.2), 0, 100);
  if (!asleep && isSleepTime(ph)) {
    c.insomnia++;
    w.today.insomniaTicks++;
  } else if (asleep) c.insomnia = Math.max(0, c.insomnia - 2);
  if (!asleep) {
    w.today.activeTicks++;
    if (crawl) {
      w.today.crawlTicks++;
      c.happiness = clamp(c.happiness - 0.04, 0, 100);
    }
    if (c.silent) w.today.silentTicks++;
  }

  const prod = (crawl ? 0.55 : 1) * (c.fatigue > 80 ? 0.6 : 1);
  let tags: ActionId[] = [...opt.tags];
  if (opt.act === 'leisure' && c.silent) tags = [];
  if (!asleep && opt.act !== 'awake' && !crawl) tags.push('walk');
  let income = 0;
  let stolen = 0;

  switch (opt.act) {
    case 'sleep':
      c.happiness = clamp(c.happiness + 0.05, 0, 100);
      break;
    case 'work':
      income = doWork(w, c, prod);
      break;
    case 'blackmarket': {
      income = (c.job === 'merchant' ? 3 : 2) * prod;
      w.today.underground += income;
      w.today.gdp += income * 0.5;
      const tradeLawExists = w.laws.some((l) => l.action === 'trade' && l.outcome !== 'reward');
      if (tradeLawExists && chance(w, ctx.pPublic * 0.25)) {
        w.treasury += income + Math.min(c.money, 10);
        c.money = Math.max(0, c.money - 10);
        income = 0;
        c.arrests++;
      } else {
        c.loopholeGain += income;
      }
      break;
    }
    case 'beg': {
      const donor = pick(w, w.citizens);
      if (donor !== c && donor.money > 40 && chance(w, 0.3)) {
        donor.money -= 1;
        c.money += 1;
      }
      c.happiness = clamp(c.happiness - 0.1, 0, 100);
      break;
    }
    case 'leisure':
      c.happiness = clamp(c.happiness + (c.silent ? 0.2 : 0.6), 0, 100);
      break;
    case 'steal_apple':
    case 'steal_pear':
      w.today.crimes++;
      if (ctx.t.night) w.today.nightCrimes++;
      if (w.food > 0) w.food -= 1;
      c.hunger = Math.max(0, c.hunger - 30);
      stolen = w.foodPrice;
      victimize(w, c, 'farmer', 2);
      if (skippedApple) {
        w.today.loopholes++;
        c.loopholeGain += 3;
        if (w.today.loopholes <= 1) {
          const law = w.laws.find((l) => l.action === 'steal_apple' && isPenalty(l.outcome));
          if (law) logEvent(w, 'loophole', `${jobName(c.job)}${c.name}は、条文がリンゴにしか触れていないことに気づき、梨だけを盗むようになった。「${lawText(law)}」は梨泥棒を裁けない。`, 34, { citizenId: c.id });
        }
      }
      break;
    case 'steal': {
      w.today.crimes++;
      if (ctx.t.night) w.today.nightCrimes++;
      const v = richVictim(w, c);
      if (v) {
        stolen = Math.min(Math.round(v.money * 0.25), 40);
        v.money -= stolen;
        c.money += stolen;
        v.victimToday = true;
        v.happiness = clamp(v.happiness - 4, 0, 100);
      }
      break;
    }
    case 'assault': {
      w.today.crimes++;
      if (ctx.t.night) w.today.nightCrimes++;
      const v = pick(w, w.citizens);
      if (v !== c) {
        v.happiness = clamp(v.happiness - 10, 0, 100);
        v.victimToday = true;
      }
      c.happiness = clamp(c.happiness + 3, 0, 100);
      break;
    }
  }

  applyLaws(w, c, tags, opt, ctx, income, stolen);
}

function victimize(w: World, thief: Citizen, job: Job, dmg: number) {
  const pool = w.citizens.filter((x) => x.job === job && x !== thief);
  if (pool.length === 0) return;
  const v = pick(w, pool);
  v.happiness = clamp(v.happiness - dmg, 0, 100);
  v.victimToday = true;
}

function richVictim(w: World, thief: Citizen): Citizen | null {
  let best: Citizen | null = null;
  for (let i = 0; i < 3; i++) {
    const v = pick(w, w.citizens);
    if (v !== thief && v.money > 15 && (!best || v.money > best.money)) best = v;
  }
  return best;
}

function doWork(w: World, c: Citizen, prod: number): number {
  let income = 0;
  switch (c.job) {
    case 'farmer': {
      const crop = 1.3 * prod;
      w.food += crop;
      w.today.harvest += crop;
      w.today.gdp += crop * w.foodPrice;
      income = Math.min(w.marketPot, crop * w.foodPrice * 0.8);
      w.marketPot -= income;
      break;
    }
    case 'merchant':
      income = 4 * prod;
      w.today.trade += income;
      w.today.gdp += income;
      c.happiness = clamp(c.happiness + 0.05, 0, 100);
      break;
    case 'guard':
      if (w.treasury >= 1.3) {
        w.treasury -= 1.3;
        income = 1.3;
      } else c.happiness = clamp(c.happiness - 0.3, 0, 100);
      w.today.gdp += 1.3;
      break;
    case 'lawyer':
      income = 1.2 * prod;
      w.today.gdp += income;
      break;
  }
  if (c.job !== 'guard') {
    const base = income * BASE_TAX;
    w.treasury += base;
    w.today.taxes += base;
    income -= base;
  }
  return income;
}

function applyLaws(w: World, c: Citizen, tags: ActionId[], opt: Option, ctx: Ctx, income: number, stolen: number) {
  for (const law of w.laws) {
    if (!lawApplies(law, c, tags, ctx.t, opt.place)) continue;
    const continuous = CONTINUOUS_ACTIONS.has(law.action);
    if (law.outcome === 'tax') {
      const taxable = income > 0 ? income : stolen > 0 ? stolen : continuous ? 0 : law.amount / 10;
      const tax = Math.min(c.money + income, taxable * (law.amount / 100));
      if (tax > 0) {
        income -= tax;
        w.treasury += tax;
        w.today.taxes += tax;
      }
      continue;
    }
    if (continuous && c.settledToday.includes(law.id)) continue;
    if (law.outcome === 'reward') {
      if (w.treasury >= law.amount) {
        w.treasury -= law.amount;
        c.money += law.amount;
        w.today.rewards += law.amount;
        c.happiness = clamp(c.happiness + 1, 0, 100);
        if (CRIME_ACTIONS.has(law.action)) c.loopholeGain += law.amount;
      } else {
        w.today.unpaidRewards++;
        c.happiness = clamp(c.happiness - 1, 0, 100);
      }
      if (continuous) c.settledToday.push(law.id);
      continue;
    }
    if (law.outcome === 'ban') continue;
    const p = CRIME_ACTIONS.has(law.action) ? ctx.pCrime : ctx.pPublic * (continuous ? 0.35 : 1);
    if (!chance(w, p)) continue;
    c.settledToday.push(law.id);
    arrest(w, c, law, opt, tags);
    if (!w.citizens.includes(c) || c.status === 'jailed') break;
  }
  c.money += income;
}

function arrest(w: World, c: Citizen, law: Law, opt: Option, tags: ActionId[]) {
  w.today.arrests++;
  c.arrests++;
  c.fear = clamp(c.fear + 4, 0, 100);
  const pc: PendingCase = {
    defendantId: c.id,
    lawId: law.id,
    lawSnapshot: { ...law, holes: { ...law.holes } },
    tick: w.tick,
    hour: w.tick % 24,
    place: opt.place,
    activity: opt.act,
    tags: [...tags],
  };
  if (w.civLevel >= 3) {
    w.courtQueue.push(pc);
  } else {
    trial(w, pc, false);
  }
}

function holdCourt(w: World) {
  const queue = w.courtQueue;
  w.courtQueue = [];
  for (const pc of queue) trial(w, pc, true);
}

const CAUGHT_DOING: Partial<Record<Activity, string>> = {
  sleep: 'すやすや眠っているところを',
  work: '働いているところを',
  leisure: '友人と立ち話をしているところを',
  steal_apple: 'リンゴをかじっているところを',
  steal_pear: '梨をかじっているところを',
  steal: '財布を抜き取ったところを',
  assault: '隣人を殴ったところを',
  awake: '起きていたところを',
  beg: '物乞いをしていたところを',
  blackmarket: '路地裏で取引していたところを',
};

function caughtPhrase(pc: PendingCase): string {
  const law = pc.lawSnapshot;
  if (law.action === 'walk') return pc.activity === 'sleep' ? '寝ぼけて歩いたところを' : '道を歩いているところを';
  if (law.action === 'harvest') return 'カブを収穫しているところを';
  if (law.action === 'trade') return 'パンを売っているところを';
  if (law.action === 'speak') return '「おはよう」と言ったところを';
  if (law.action === 'sue') return '訴状を提出したところを';
  if (law.action === 'immigrate') return '国境を越えたところを';
  return CAUGHT_DOING[pc.activity] ?? '';
}

function caseScore(law: Law, acquitted: boolean, byLawyer: boolean): number {
  let s = 0;
  switch (law.outcome) {
    case 'fine':
      s = 6 + Math.min(20, law.amount / 40);
      break;
    case 'jail':
      s = 12 + law.amount;
      break;
    case 'exile':
      s = 30;
      break;
    case 'death':
      s = 55;
      break;
  }
  if (!CRIME_ACTIONS.has(law.action)) s += 18;
  if (acquitted && byLawyer) s += 40;
  if (law.convictions === 0 && !acquitted) s += 22;
  return s;
}

const caseLogCount = new Map<string, number>();

function trial(w: World, pc: PendingCase, withCourt: boolean) {
  const c = w.citizens.find((x) => x.id === pc.defendantId);
  if (!c) return;
  const law = w.laws.find((l) => l.id === pc.lawId) ?? pc.lawSnapshot;
  const v = judge(w, pc, c, withCourt);
  w.totals.cases++;
  const no = ++w.caseCounter;
  const who = `${c.foreigner ? '外国人' : ''}${jobName(c.job)}${c.name}`;
  const lt = lawText(pc.lawSnapshot);
  let text = `【第${no}号判例】${who}は${caughtPhrase(pc)}${withCourt ? '逮捕され、' : '衛兵に見つかり、'}「${lt}」${withCourt ? 'で起訴された。' : 'の掟で裁かれた。'}`;

  if (v.lawyer) {
    text += `弁護士${v.lawyer.name}は「${v.defense!.argument}」と主張。`;
    if (v.lawyer.money !== undefined && c.money >= 15) {
      c.money -= 15;
      v.lawyer.money += 15;
    }
  }

  let score: number;
  if (v.acquitted) {
    w.totals.acquittals++;
    if (v.lawyer) {
      v.lawyer.wins++;
      v.lawyer.money += 20;
      law.defeats++;
      law.holes[v.defense!.kind] = (law.holes[v.defense!.kind] ?? 0) + 1;
      text += '裁判所はこれを認め、無罪。';
    } else {
      text += `裁判官は「${v.defense!.argument}」として、無罪を言い渡した。`;
    }
    score = caseScore(pc.lawSnapshot, true, !!v.lawyer);
    c.happiness = clamp(c.happiness + 5, 0, 100);
  } else {
    law.convictions++;
    let amount = pc.lawSnapshot.amount;
    if (v.reduced && (law.outcome === 'fine' || law.outcome === 'jail')) {
      amount = Math.max(1, Math.round(amount / 2));
      text += '主張は退けられたが情状酌量が認められ、';
    } else if (v.lawyer) {
      text += '主張は退けられ、';
    }
    text += `${outcomeText(pc.lawSnapshot.outcome, amount)}${pc.lawSnapshot.outcome === 'death' ? 'が執行された。' : 'に処された。'}`;
    score = caseScore(pc.lawSnapshot, false, false);
    sentence(w, c, pc.lawSnapshot.outcome, amount, text);
  }

  const key = `${day(w)}:${law.id}:${v.acquitted}`;
  const n = caseLogCount.get(key) ?? 0;
  caseLogCount.set(key, n + 1);
  if (caseLogCount.size > 500) caseLogCount.clear();
  if (n < 3 || score >= 50) logEvent(w, 'verdict', text, score - n * 3, { caseNo: no, citizenId: c.id });
}

function sentence(w: World, c: Citizen, outcome: Law['outcome'], amount: number, _text: string) {
  switch (outcome) {
    case 'fine': {
      const paid = Math.min(c.money, amount);
      c.money -= paid;
      w.treasury += paid;
      w.today.fines += paid;
      c.happiness = clamp(c.happiness - Math.min(20, amount / 15), 0, 100);
      const short = amount - paid;
      if (short > 0) jail(w, c, Math.ceil(short / 30));
      break;
    }
    case 'jail':
      jail(w, c, amount);
      break;
    case 'exile':
      removeCitizen(w, c, 'exile');
      break;
    case 'death':
      removeCitizen(w, c, 'death');
      for (const x of w.citizens) {
        x.fear = clamp(x.fear + 3, 0, 100);
        x.happiness = clamp(x.happiness - 1.5, 0, 100);
      }
      break;
  }
}

function jail(w: World, c: Citizen, days: number) {
  c.status = 'jailed';
  c.jailUntil = Math.max(c.jailUntil, w.tick) + days * 24;
  c.activity = 'jail';
  c.place = 'jail';
  c.happiness = clamp(c.happiness - 8, 0, 100);
}

function removeCitizen(w: World, c: Citizen, why: 'exile' | 'death' | 'starve' | 'emigrate') {
  const i = w.citizens.indexOf(c);
  if (i < 0) return;
  w.citizens.splice(i, 1);
  if (why === 'exile') {
    w.treasury += c.money;
    w.today.exiles++;
    w.totals.exiled++;
  } else if (why === 'emigrate') {
    w.today.emigrants++;
  } else {
    w.today.deaths++;
    w.totals.died++;
  }
  w.courtQueue = w.courtQueue.filter((p) => p.defendantId !== c.id);
}

function meals(w: World) {
  for (const c of w.citizens) {
    if (c.status === 'jailed' || c.activity === 'sleep' || c.hunger < 25) continue;
    if (w.food < 1) continue;
    if (c.job === 'farmer' && c.activity === 'work') {
      w.food -= 1;
      c.hunger = Math.max(0, c.hunger - 35);
      continue;
    }
    if (c.money >= w.foodPrice) {
      c.money -= w.foodPrice;
      w.marketPot += w.foodPrice;
      w.food -= 1;
      c.hunger = Math.max(0, c.hunger - 35);
    }
  }
}

// ───────── 1日ごとの更新 ─────────

export function updateWealth(w: World) {
  const sorted = [...w.citizens].sort((a, b) => b.money - a.money);
  const n = sorted.length;
  sorted.forEach((c, i) => {
    c.wealthRank = i;
    c.isNoble = i < Math.max(1, Math.round(n * 0.1));
    c.isPoor = i >= n - Math.max(1, Math.round(n * 0.2));
  });
}

function computeSafety(w: World, s: DayStats) {
  const pop = Math.max(1, w.citizens.length);
  return clamp(Math.round(100 - (s.crimes / pop) * 160), 0, 100);
}

function dailyUpdate(w: World) {
  const s = w.today;
  w.safety = computeSafety(w, s);
  w.yesterday = s;
  w.today = emptyStats();
  const pop = w.citizens.length;

  // 食料と物価
  w.food = Math.min(w.food * 0.97, pop * 12 + 50);
  const target = pop * 6;
  w.foodPrice = Math.round(clamp(4 * Math.sqrt(target / Math.max(1, w.food)), 2, 25) * 10) / 10;
  const freedom = freedomIndex(w.laws);
  const tradePerCap = s.trade / Math.max(1, pop);

  // 幸福度
  for (const c of w.citizens) {
    let target = 40;
    target += c.hunger > 80 ? -30 : c.hunger > 55 ? -10 : 6;
    target += c.money > 80 ? 8 : c.money > 25 ? 3 : c.money < 5 ? -10 : 0;
    target += (freedom - 60) / 6;
    target += (w.safety - 70) / 4;
    target += Math.min(5, tradePerCap * 0.5);
    if (c.insomnia > 4) target -= 18;
    if (c.silent) target -= 6;
    if (c.crawling) target -= 6;
    if (c.victimToday) target -= 8;
    if (c.status === 'jailed') target -= 20;
    c.happiness = clamp(c.happiness + (target - c.happiness) * 0.25, 0, 100);
    c.settledToday = [];
    c.victimToday = false;
    if (c.hunger >= 98) c.starving++;
    else c.starving = 0;
  }

  // 餓死
  for (const c of [...w.citizens]) {
    if (c.starving >= 2) {
      removeCitizen(w, c, 'starve');
      logEvent(w, 'starve', `${jobName(c.job)}${c.name}が餓死した。所持金${Math.round(c.money)}G、食料の値段は${w.foodPrice}G。`, 26, { citizenId: c.id });
    }
  }

  jobMarket(w);
  if (w.civLevel >= 3) {
    lawyers(w);
    lawsuits(w, s);
  }
  population_(w);
  unrest(w);
  updateWealth(w);
  tycoons(w);
  civProgress(w, s);

  const snap = snapshot(w);
  snap.gdp = Math.round(s.gdp);
  snap.underground = undergroundShare(s);
  w.history.push(snap);
  if (w.history.length > 120) w.history.shift();
  dailyNews(w, s);

  if (w.citizens.length === 0) {
    w.collapsed = true;
    logEvent(w, 'revolution', `${w.nationName}は滅亡した。最後の国民がいなくなり、法典だけが風に吹かれている。`, 100);
  }
}

function jobLegalCost(w: World, c: Citizen, job: Job): number {
  const tags = WORK_TAGS[job];
  if (tags.length === 0) return 0;
  const fake = { ...c, job } as Citizen;
  const ctx: Ctx = { t: timeContext(Math.floor(w.tick / 24) * 24 + 10), pCrime: 0.3, pPublic: 0.3 };
  return legalCost(w, fake, tags, WORK_PLACE[job], ctx, expectedIncome(w, fake));
}

function jobMarket(w: World) {
  const pop = w.citizens.length;
  const count = (j: Job) => w.citizens.filter((c) => c.job === j).length;
  for (const c of w.citizens) {
    if (c.status === 'jailed') continue;
    if (c.job !== 'unemployed' && c.job !== 'lawyer') {
      const cost = jobLegalCost(w, c, c.job);
      const unpaidGuard = c.job === 'guard' && w.treasury < 5;
      if ((cost > 3.5 && chance(w, 0.35)) || (unpaidGuard && chance(w, 0.15))) {
        logEvent(w, 'misc', `${jobName(c.job)}${c.name}は${unpaidGuard ? '給料が払われず' : '法を恐れて'}仕事を辞めた。`, cost > 6 ? 12 : 4, { citizenId: c.id });
        setJob(w, c, 'unemployed');
      }
      continue;
    }
    if (c.job !== 'unemployed' || !chance(w, 0.5)) continue;
    const farmers = count('farmer');
    const merchants = count('merchant');
    const guards = count('guard');
    const choices: [Job, number][] = [
      ['farmer', 1.2 + (w.foodPrice - 4) * 0.8 - (farmers > pop * 0.45 ? 2 : 0)],
      ['merchant', w.civLevel >= 1 ? 1.5 + (merchants < pop * 0.2 ? 1 : -1.5) : -9],
      ['guard', guards < pop * 0.12 && w.treasury > 150 ? 2.5 : -5],
    ];
    let bestJob: Job | null = null;
    let bestScore = 1;
    for (const [j, sc] of choices) {
      const s = sc - jobLegalCost(w, c, j) + nextRandom(w);
      if (s > bestScore) {
        bestScore = s;
        bestJob = j;
      }
    }
    if (bestJob) setJob(w, c, bestJob);
  }
}

function setJob(w: World, c: Citizen, job: Job) {
  c.formerJob = c.job;
  c.job = job;
  c.jobSince = w.tick;
}

function lawyers(w: World) {
  const pop = w.citizens.length;
  const lawyerCount = w.citizens.filter((c) => c.job === 'lawyer').length;
  const sueReward = w.laws.some((l) => l.action === 'sue' && l.outcome === 'reward');
  const cap = Math.max(1, Math.round(pop * (sueReward ? 0.25 : 0.08)));
  if (lawyerCount >= cap) return;
  for (const c of w.citizens) {
    if (c.job === 'lawyer' || c.intelligence < 70 || c.status === 'jailed') continue;
    if (!chance(w, 0.04 + (w.courtQueue.length > 5 ? 0.04 : 0))) continue;
    setJob(w, c, 'lawyer');
    c.money += 10;
    const first = !w.milestones.includes('first-lawyer');
    if (first) w.milestones.push('first-lawyer');
    logEvent(
      w,
      'lawyer',
      first
        ? `国で初めての弁護士が誕生した。元${jobName(c.formerJob ?? 'unemployed')}の${c.name}（知性${c.intelligence}）は「あなたの法典には穴がある」と言い残し、法律事務所を開いた。`
        : `元${jobName(c.formerJob ?? 'unemployed')}の${c.name}が弁護士になった。`,
      first ? 60 : 10,
      { citizenId: c.id },
    );
    break;
  }
}

function lawsuits(w: World, s: DayStats) {
  const pop = w.citizens.length;
  if (pop < 4) return;
  const lawyerCount = w.citizens.filter((c) => c.job === 'lawyer').length;
  const ctx: Ctx = { t: timeContext(w.tick + 10), pCrime: 0.3, pPublic: 0.5 };
  const expected = pop * 0.01 + lawyerCount * 0.35 + s.crimes * 0.05;
  const tries = Math.round(expected * 2);
  let filed = 0;
  for (let i = 0; i < tries; i++) {
    const p = pick(w, w.citizens);
    const d = pick(w, w.citizens);
    if (p === d || p.status === 'jailed') continue;
    const cost = legalCost(w, p, ['sue'], 'court', ctx, 0);
    const want = 0.5 + p.greed / 200 - cost / 3;
    if (!chance(w, clamp(want, 0, 0.98))) continue;
    filed++;
    w.today.lawsuits++;
    p.activity = 'court';
    d.activity = 'court';
    const damages = Math.min(d.money, randInt(w, 5, 40));
    const pl = p.intelligence + (lawyerCount > 0 ? 20 : 0);
    const df = d.intelligence + (lawyerCount > 0 && d.money > 30 ? 20 : 0);
    const plaintiffWins = nextRandom(w) * (pl + df) < pl;
    if (plaintiffWins) {
      d.money -= damages;
      p.money += damages * 0.7;
    }
    const lawyerPool = w.citizens.filter((c) => c.job === 'lawyer');
    if (lawyerPool.length) {
      const fee = damages * 0.3 + 3;
      pick(w, lawyerPool).money += fee;
      w.today.gdp += fee;
    }
    applyLaws(w, p, ['sue'], { act: 'court', tags: ['sue'], place: 'court', base: 0, income: 0 }, ctx, 0, 0);
    if (damages >= 35 && chance(w, 0.3)) {
      logEvent(w, 'lawsuit', `【民事】${p.name}は${d.name}を「${pick(w, ['飼い犬がうるさい', '目つきが悪い', '自分の畑を見た', '昨日の挨拶が冷たかった', '影が自宅の庭に入った'])}」として提訴。${plaintiffWins ? `${damages}Gの賠償が認められた。` : '訴えは棄却された。'}`, 14);
    }
  }
  if (filed > pop * 0.15 && !w.milestones.includes('litigation')) {
    w.milestones.push('litigation');
    logEvent(w, 'lawsuit', `訴訟社会が到来。この日だけで${filed}件の訴えが起こされ、仕事より裁判所に通う時間のほうが長い国民が続出している。`, 45);
  }
}

function population_(w: World) {
  const h = avgHappiness(w);
  const pop = w.citizens.length;
  // 出生
  if (h > 45 && w.foodPrice < 9 && pop < MAX_POPULATION && pop >= 2) {
    const expected = pop * 0.012 * ((h - 45) / 30);
    let n = Math.floor(expected) + (chance(w, expected % 1) ? 1 : 0);
    while (n-- > 0 && w.citizens.length < MAX_POPULATION) {
      const c = newCitizen(w, 'unemployed', { money: 5, hunger: 10 });
      w.citizens.push(c);
      w.today.births++;
      w.totals.born++;
    }
  }
  // 移民
  if (pop < MAX_POPULATION) {
    const expected = Math.max(0, (h - 42) / 22) * (0.5 + w.civLevel * 0.3);
    let n = Math.floor(expected) + (chance(w, expected % 1) ? 1 : 0);
    const ctx: Ctx = { t: timeContext(w.tick + 9), pCrime: 0.5, pPublic: 0.8 };
    let turnedAway = 0;
    while (n-- > 0 && w.citizens.length < MAX_POPULATION) {
      const c = newCitizen(w, 'unemployed', { foreigner: true, money: randInt(w, 10, 60) });
      const cost = legalCost(w, c, ['immigrate', 'walk'], 'street', ctx, 0);
      if (cost > 2.5) {
        turnedAway++;
        continue;
      }
      w.citizens.push(c);
      w.today.immigrants++;
      applyLaws(w, c, ['immigrate'], { act: 'awake', tags: ['immigrate'], place: 'street', base: 0, income: 0 }, ctx, 0, 0);
    }
    if (turnedAway >= 2 && chance(w, 0.3)) logEvent(w, 'misc', `国境の看板を読んだ移民${turnedAway}人が、入国をあきらめて引き返していった。`, 8);
  }
  // 国外流出
  let left = 0;
  for (const c of [...w.citizens]) {
    if (c.happiness < 22 && c.status === 'free' && chance(w, 0.07)) {
      removeCitizen(w, c, 'emigrate');
      left++;
    }
  }
  if (left >= 3) logEvent(w, 'emigrate', `幸福度の低さに耐えかね、${left}人の国民が国を捨てて出ていった。`, 10 + left * 2);
}

function unrest(w: World) {
  const h = avgHappiness(w);
  if (h < 20) w.lowHappyDays++;
  else w.lowHappyDays = Math.max(0, w.lowHappyDays - 1);
  if (w.lowHappyDays === 2) {
    const loot = Math.round(w.treasury * 0.3);
    w.treasury -= loot;
    logEvent(w, 'riot', `暴動発生。怒れる国民が国庫を襲い、${loot}Gが持ち去られた。法典の前には「神は寝ているのか」と落書きされている。`, 50);
  }
  if (w.lowHappyDays >= 4 && w.laws.length > 0) {
    const n = w.laws.length;
    w.laws = [];
    w.lowHappyDays = 0;
    w.treasury = 0;
    w.totals.revolutions++;
    for (const c of w.citizens) c.happiness = clamp(c.happiness + 25, 0, 100);
    logEvent(w, 'revolution', `革命が起きた。国民は法典を広場で燃やし、${n}つの条文はすべて失われた。新しい神託が待たれている。`, 90);
  }
}

function tycoons(w: World) {
  for (const c of w.citizens) {
    for (const th of [500, 2000, 5000]) {
      if (c.money < th) continue;
      const key = `tycoon:${c.id}:${th}`;
      if (w.milestones.includes(key)) continue;
      w.milestones.push(key);
      const shady = c.loopholeGain > c.money * 0.3;
      logEvent(
        w,
        'tycoon',
        shady
          ? `悪徳${jobName(c.job)}${c.name}の資産が${th}Gを突破。財産の多くは法の抜け穴（闇取引・梨泥棒・報酬目当ての行為）で築いたものだ。`
          : `${jobName(c.job)}${c.name}の資産が${th}Gを突破し、国一番の富豪の仲間入りをした。`,
        shady ? 30 + th / 100 : 10 + th / 200,
        { citizenId: c.id },
      );
    }
  }
  if (w.milestones.length > 400) w.milestones = w.milestones.filter((m) => !m.startsWith('tycoon:')).concat(w.milestones.filter((m) => m.startsWith('tycoon:')).slice(-200));
}

function civProgress(w: World, s: DayStats) {
  const pop = w.citizens.length;
  w.civPoints += s.gdp / 45 + pop / 6 + (w.safety > 60 ? 2 : 0) + (freedomIndex(w.laws) > 60 ? 1 : 0);
  const next = nextCiv(w.civLevel);
  if (next && w.civPoints >= next.points) {
    w.civLevel = next.level;
    logEvent(w, 'civ', `文明レベルが上がり「${next.name}」になった！ 解放：${next.unlocks}`, 70);
  }
}

// ───────── まとめ進行 ─────────

export function advance(w: World, ticks: number) {
  for (let i = 0; i < ticks && !w.collapsed; i++) step(w);
}

export function citizenById(w: World, id: number) {
  return w.citizens.find((c) => c.id === id) ?? null;
}
