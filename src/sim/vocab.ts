// 条文パズルの語彙。unlock は解放される文明レベル。

export type SubjectId =
  | 'anyone'
  | 'farmer'
  | 'merchant'
  | 'guard'
  | 'lawyer'
  | 'noble'
  | 'poor'
  | 'foreigner';
export type ConditionId = 'none' | 'night' | 'day' | 'market' | 'street' | 'holiday';
export type ActionId =
  | 'work'
  | 'harvest'
  | 'trade'
  | 'steal_apple'
  | 'steal'
  | 'assault'
  | 'walk'
  | 'sleep'
  | 'speak'
  | 'immigrate'
  | 'sue';
export type OutcomeId = 'fine' | 'jail' | 'exile' | 'death' | 'reward' | 'tax' | 'ban';

export interface VocabEntry<T extends string> {
  id: T;
  label: string;
  unlock: number;
  hint?: string;
}

export const SUBJECTS: VocabEntry<SubjectId>[] = [
  { id: 'anyone', label: '者', unlock: 1, hint: '全国民' },
  { id: 'farmer', label: '農民', unlock: 1 },
  { id: 'guard', label: '衛兵', unlock: 1 },
  { id: 'poor', label: '貧民', unlock: 1, hint: '資産下位20%' },
  { id: 'merchant', label: '商人', unlock: 2 },
  { id: 'lawyer', label: '弁護士', unlock: 3 },
  { id: 'noble', label: '貴族', unlock: 4, hint: '資産上位10%' },
  { id: 'foreigner', label: '外国人', unlock: 5, hint: '移民' },
];

/** 主語をチップに表示するときの名前（「者」だと分かりにくいので） */
export const SUBJECT_CHIP: Record<SubjectId, string> = {
  anyone: '誰でも',
  farmer: '農民',
  guard: '衛兵',
  poor: '貧民',
  merchant: '商人',
  lawyer: '弁護士',
  noble: '貴族',
  foreigner: '外国人',
};

export const CONDITIONS: VocabEntry<ConditionId>[] = [
  { id: 'none', label: '', unlock: 1, hint: '条件なし' },
  { id: 'night', label: '夜間に', unlock: 1, hint: '20時〜翌4時' },
  { id: 'day', label: '日中に', unlock: 1, hint: '6時〜17時' },
  { id: 'market', label: '市場で', unlock: 2 },
  { id: 'street', label: '路上で', unlock: 2 },
  { id: 'holiday', label: '休日に', unlock: 3, hint: '7日に1度' },
];

export const ACTIONS: VocabEntry<ActionId>[] = [
  { id: 'work', label: '労働した', unlock: 1 },
  { id: 'harvest', label: '収穫した', unlock: 1 },
  { id: 'steal_apple', label: 'リンゴを盗んだ', unlock: 1 },
  { id: 'steal', label: '盗みを働いた', unlock: 1 },
  { id: 'walk', label: '歩いた', unlock: 1 },
  { id: 'sleep', label: '眠った', unlock: 1 },
  { id: 'trade', label: '売買した', unlock: 2 },
  { id: 'assault', label: '暴力をふるった', unlock: 2 },
  { id: 'sue', label: '訴えた', unlock: 3 },
  { id: 'speak', label: '発言した', unlock: 4 },
  { id: 'immigrate', label: '入国した', unlock: 5 },
];

export interface OutcomeEntry extends VocabEntry<OutcomeId> {
  kind: 'penalty' | 'reward' | 'tax' | 'norm';
  amount?: { min: number; max: number; step: number; def: number; unit: string };
}

export const OUTCOMES: OutcomeEntry[] = [
  { id: 'fine', label: '罰金', unlock: 1, kind: 'penalty', amount: { min: 10, max: 1000, step: 10, def: 100, unit: 'G' } },
  { id: 'jail', label: '投獄', unlock: 1, kind: 'penalty', amount: { min: 1, max: 30, step: 1, def: 3, unit: '日' } },
  { id: 'exile', label: '国外追放', unlock: 1, kind: 'penalty' },
  { id: 'reward', label: '報酬', unlock: 1, kind: 'reward', amount: { min: 1, max: 200, step: 1, def: 10, unit: 'G' } },
  { id: 'ban', label: '禁止（罰則なし）', unlock: 1, kind: 'norm' },
  { id: 'tax', label: '課税', unlock: 2, kind: 'tax', amount: { min: 5, max: 100, step: 5, def: 20, unit: '%' } },
  { id: 'death', label: '死刑', unlock: 2, kind: 'penalty' },
];

/** 毎時間くり返し行う「継続的な行動」。罰則・報酬は1日1回まで。 */
export const CONTINUOUS_ACTIONS: ReadonlySet<ActionId> = new Set(['work', 'harvest', 'trade', 'walk', 'sleep', 'speak']);
/** 犯罪行為（摘発確率の計算が違う） */
export const CRIME_ACTIONS: ReadonlySet<ActionId> = new Set(['steal_apple', 'steal', 'assault']);

export function subjectOf(id: SubjectId) {
  return SUBJECTS.find((s) => s.id === id)!;
}
export function conditionOf(id: ConditionId) {
  return CONDITIONS.find((s) => s.id === id)!;
}
export function actionOf(id: ActionId) {
  return ACTIONS.find((s) => s.id === id)!;
}
export function outcomeOf(id: OutcomeId) {
  return OUTCOMES.find((s) => s.id === id)!;
}
