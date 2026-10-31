import type { ActionId, ConditionId, OutcomeId, SubjectId } from './vocab';

export interface Law {
  id: number;
  subject: SubjectId;
  condition: ConditionId;
  action: ActionId;
  outcome: OutcomeId;
  amount: number;
  enactedTick: number;
  /** この条文で有罪になった数 */
  convictions: number;
  /** 弁護士に破られた数と、破られた穴の種類 */
  defeats: number;
  holes: Partial<Record<DefenseKind, number>>;
}

export type Job = 'farmer' | 'merchant' | 'guard' | 'lawyer' | 'unemployed';

export type Activity =
  | 'sleep'
  | 'work'
  | 'leisure'
  | 'steal_apple'
  | 'steal_pear'
  | 'steal'
  | 'assault'
  | 'blackmarket'
  | 'beg'
  | 'awake'
  | 'jail'
  | 'court';

export type Place = 'home' | 'field' | 'market' | 'street' | 'plaza' | 'court' | 'alley' | 'jail';

export interface Citizen {
  id: number;
  name: string;
  job: Job;
  formerJob: Job | null;
  jobSince: number;
  money: number;
  hunger: number;
  fatigue: number;
  happiness: number;
  lawfulness: number;
  greed: number;
  fear: number;
  intelligence: number;
  foreigner: boolean;
  status: 'free' | 'jailed';
  jailUntil: number;
  activity: Activity;
  place: Place;
  /** 見た目フラグ（悪法のカオス演出） */
  crawling: boolean;
  silent: boolean;
  insomnia: number;
  starving: number;
  arrests: number;
  wins: number;
  loopholeGain: number;
  victimToday: boolean;
  /** 今日すでに罰/報酬を受けた条文ID（継続行動は1日1回） */
  settledToday: number[];
  isNoble: boolean;
  isPoor: boolean;
  wealthRank: number;
}

export type DefenseKind =
  | 'retroactive'
  | 'repealed'
  | 'conflict'
  | 'condition'
  | 'object'
  | 'subject'
  | 'vague';

export interface PendingCase {
  defendantId: number;
  lawId: number;
  lawSnapshot: Law;
  tick: number;
  hour: number;
  place: Place;
  activity: Activity;
  tags: string[];
}

export type EventKind =
  | 'verdict'
  | 'summary'
  | 'reward'
  | 'loophole'
  | 'exile'
  | 'death'
  | 'starve'
  | 'emigrate'
  | 'immigrant'
  | 'birth'
  | 'lawyer'
  | 'civ'
  | 'riot'
  | 'revolution'
  | 'lawsuit'
  | 'tycoon'
  | 'crime'
  | 'law'
  | 'misc';

export interface GameEvent {
  tick: number;
  kind: EventKind;
  text: string;
  score: number;
  caseNo?: number;
  citizenId?: number;
}

export interface NewsItem {
  tick: number;
  key: string;
  text: string;
  score: number;
}

export interface DayStats {
  gdp: number;
  trade: number;
  underground: number;
  crimes: number;
  arrests: number;
  nightCrimes: number;
  births: number;
  immigrants: number;
  emigrants: number;
  exiles: number;
  deaths: number;
  lawsuits: number;
  taxes: number;
  fines: number;
  rewards: number;
  harvest: number;
  crawlTicks: number;
  insomniaTicks: number;
  silentTicks: number;
  activeTicks: number;
  loopholes: number;
  unpaidRewards: number;
}

export interface Snapshot {
  day: number;
  population: number;
  gdp: number;
  treasury: number;
  safety: number;
  happiness: number;
  freedom: number;
  underground: number;
  food: number;
  civLevel: number;
}

export interface World {
  version: number;
  nationName: string;
  rng: number;
  tick: number;
  citizens: Citizen[];
  nextCitizenId: number;
  laws: Law[];
  nextLawId: number;
  treasury: number;
  food: number;
  foodPrice: number;
  /** 食料の売上（農民の収入源） */
  marketPot: number;
  civLevel: number;
  civPoints: number;
  today: DayStats;
  yesterday: DayStats;
  history: Snapshot[];
  events: GameEvent[];
  news: NewsItem[];
  caseCounter: number;
  courtQueue: PendingCase[];
  milestones: string[];
  lowHappyDays: number;
  safety: number;
  totals: { born: number; died: number; exiled: number; cases: number; acquittals: number; revolutions: number };
  collapsed: boolean;
  generation: number;
}
