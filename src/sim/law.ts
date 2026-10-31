import type { Citizen, Law, Place } from './types';
import { actionOf, conditionOf, outcomeOf, subjectOf, type ActionId, type ConditionId, type OutcomeId, type SubjectId } from './vocab';

export interface LawDraft {
  subject: SubjectId;
  condition: ConditionId;
  action: ActionId;
  outcome: OutcomeId;
  amount: number;
}

export function outcomeText(outcome: OutcomeId, amount: number): string {
  switch (outcome) {
    case 'fine':
      return `罰金${amount}G`;
    case 'jail':
      return `投獄${amount}日`;
    case 'reward':
      return `報酬${amount}G`;
    case 'tax':
      return `${amount}%課税`;
    default:
      return outcomeOf(outcome).label;
  }
}

/** 例：「夜間に労働した者は、罰金100G」 */
export function lawText(l: LawDraft): string {
  const cond = conditionOf(l.condition).label;
  const subj = subjectOf(l.subject).label;
  return `${cond}${actionOf(l.action).label}${subj}は、${outcomeText(l.outcome, l.amount)}`;
}

export interface TimeContext {
  hour: number;
  night: boolean;
  day: boolean;
  holiday: boolean;
}

export function timeContext(tick: number): TimeContext {
  const hour = tick % 24;
  const dayIndex = Math.floor(tick / 24);
  return {
    hour,
    night: hour >= 20 || hour <= 4,
    day: hour >= 6 && hour <= 17,
    holiday: dayIndex % 7 === 6,
  };
}

export function subjectMatches(s: SubjectId, c: Citizen): boolean {
  switch (s) {
    case 'anyone':
      return true;
    case 'farmer':
    case 'merchant':
    case 'guard':
    case 'lawyer':
      return c.job === s;
    case 'noble':
      return c.isNoble;
    case 'poor':
      return c.isPoor;
    case 'foreigner':
      return c.foreigner;
  }
}

export function conditionMatches(cond: ConditionId, t: TimeContext, place: Place): boolean {
  switch (cond) {
    case 'none':
      return true;
    case 'night':
      return t.night;
    case 'day':
      return t.day;
    case 'holiday':
      return t.holiday;
    case 'market':
      return place === 'market';
    case 'street':
      return place === 'street' || place === 'plaza';
  }
}

export function lawApplies(law: Law, c: Citizen, tags: readonly string[], t: TimeContext, place: Place): boolean {
  return tags.includes(law.action) && subjectMatches(law.subject, c) && conditionMatches(law.condition, t, place);
}

export function isPenalty(o: OutcomeId): boolean {
  return o === 'fine' || o === 'jail' || o === 'exile' || o === 'death';
}

/** 罰の重さをお金換算した値（国民の損得計算に使う） */
export function penaltyValue(law: Pick<Law, 'outcome' | 'amount'>): number {
  switch (law.outcome) {
    case 'fine':
      return law.amount;
    case 'jail':
      return law.amount * 18;
    case 'exile':
      return 700;
    case 'death':
      return 2500;
    default:
      return 0;
  }
}

/** 自由度を下げる重み */
export function oppression(law: Law): number {
  const breadth = law.subject === 'anyone' ? 1 : 0.45;
  const cond = law.condition === 'none' ? 1 : 0.6;
  let w = 0;
  switch (law.outcome) {
    case 'ban':
      w = 4;
      break;
    case 'fine':
      w = 3 + Math.min(10, law.amount / 60);
      break;
    case 'jail':
      w = 5 + law.amount * 0.4;
      break;
    case 'exile':
      w = 12;
      break;
    case 'death':
      w = 22;
      break;
    case 'tax':
      w = law.amount / 6;
      break;
    case 'reward':
      w = 0;
      break;
  }
  // 犯罪を罰するのは自由を奪わない（むしろ当然）
  if (law.action === 'steal' || law.action === 'steal_apple' || law.action === 'assault') w *= law.outcome === 'death' ? 0.5 : 0.15;
  return w * breadth * cond;
}

export function freedomIndex(laws: Law[]): number {
  const total = laws.reduce((s, l) => s + oppression(l), 0);
  return Math.max(0, Math.round(100 - total * 2));
}

export function sameLaw(a: LawDraft, b: LawDraft): boolean {
  return a.subject === b.subject && a.condition === b.condition && a.action === b.action && a.outcome === b.outcome;
}
