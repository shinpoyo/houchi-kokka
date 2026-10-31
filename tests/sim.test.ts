import { describe, expect, it } from 'vitest';
import { lawText, timeContext, freedomIndex } from '../src/sim/law';
import { advance, createWorld, enactLaw, repealLaw, amendLaw, avgHappiness } from '../src/sim/world';
import { buildReport, mark } from '../src/sim/report';
import { findDefenses } from '../src/sim/court';
import { offlineTicks, refreshTokens, MAX_OFFLINE_TICKS, TOKEN_MS } from '../src/game/save';
import type { PendingCase } from '../src/sim/types';

describe('条文', () => {
  it('主語＋条件＋行動＋結果を日本語にする', () => {
    expect(lawText({ subject: 'anyone', condition: 'night', action: 'work', outcome: 'fine', amount: 100 })).toBe('夜間に労働した者は、罰金100G');
    expect(lawText({ subject: 'anyone', condition: 'none', action: 'steal_apple', outcome: 'exile', amount: 0 })).toBe('リンゴを盗んだ者は、国外追放');
    expect(lawText({ subject: 'merchant', condition: 'market', action: 'trade', outcome: 'tax', amount: 20 })).toBe('市場で売買した商人は、20%課税');
  });
  it('夜と昼の境界には「どちらでもない」時間がある', () => {
    expect(timeContext(20).night).toBe(true);
    expect(timeContext(18).night || timeContext(18).day).toBe(false);
    expect(timeContext(6).day).toBe(true);
  });
  it('禁止の多い法典ほど自由度が下がる', () => {
    const w = createWorld(1);
    const before = freedomIndex(w.laws);
    enactLaw(w, { subject: 'anyone', condition: 'none', action: 'walk', outcome: 'jail', amount: 10 });
    expect(freedomIndex(w.laws)).toBeLessThan(before);
  });
  it('改正と廃止', () => {
    const w = createWorld(1);
    const l = enactLaw(w, { subject: 'anyone', condition: 'none', action: 'steal', outcome: 'fine', amount: 50 });
    amendLaw(w, l.id, { subject: 'anyone', condition: 'none', action: 'steal', outcome: 'jail', amount: 3 });
    expect(w.laws[0].outcome).toBe('jail');
    repealLaw(w, l.id);
    expect(w.laws).toHaveLength(0);
  });
});

describe('シミュレーション', () => {
  it('同じシードなら同じ結果になる（決定的）', () => {
    const a = createWorld(42);
    const b = createWorld(42);
    advance(a, 24 * 5);
    advance(b, 24 * 5);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('放置上限（480時間）を回しても壊れない', () => {
    const w = createWorld(7);
    enactLaw(w, { subject: 'anyone', condition: 'none', action: 'steal', outcome: 'jail', amount: 3 });
    advance(w, MAX_OFFLINE_TICKS);
    expect(w.citizens.length).toBeGreaterThan(0);
    expect(Number.isFinite(w.treasury)).toBe(true);
    expect(w.civLevel).toBeGreaterThanOrEqual(2);
  });
  it('歩行を罰すると国民はほふく前進を始める', () => {
    const w = createWorld(3);
    enactLaw(w, { subject: 'anyone', condition: 'none', action: 'walk', outcome: 'fine', amount: 50 });
    advance(w, 24 * 3);
    expect(w.yesterday.crawlTicks / w.yesterday.activeTicks).toBeGreaterThan(0.5);
    expect(w.news.some((n) => n.key === 'crawl')).toBe(true);
  });
  it('売買に100%課税すると地下経済が育つ', () => {
    const w = createWorld(3);
    w.civLevel = 2;
    enactLaw(w, { subject: 'anyone', condition: 'none', action: 'trade', outcome: 'tax', amount: 100 });
    advance(w, 24 * 4);
    expect(w.yesterday.underground).toBeGreaterThan(w.yesterday.trade);
  });
  it('睡眠を罰すると不眠で幸福度が下がる', () => {
    const free = createWorld(5);
    const bad = createWorld(5);
    enactLaw(bad, { subject: 'anyone', condition: 'none', action: 'sleep', outcome: 'fine', amount: 100 });
    advance(free, 24 * 8);
    advance(bad, 24 * 8);
    expect(avgHappiness(bad)).toBeLessThan(avgHappiness(free));
  });
  it('文明Lv3以降は弁護士が現れ、裁判で法の穴を突く', () => {
    const w = createWorld(11);
    w.civLevel = 3;
    enactLaw(w, { subject: 'anyone', condition: 'none', action: 'walk', outcome: 'fine', amount: 50 });
    advance(w, 24 * 12);
    expect(w.citizens.some((c) => c.job === 'lawyer')).toBe(true);
    expect(w.totals.acquittals).toBeGreaterThan(0);
  });
});

describe('弁護士の主張', () => {
  it('夜間の条文に夕暮れ（20時）の犯行なら境界を突く', () => {
    const w = createWorld(1);
    const law = enactLaw(w, { subject: 'anyone', condition: 'night', action: 'work', outcome: 'fine', amount: 100 });
    const c = w.citizens[0];
    const pc: PendingCase = { defendantId: c.id, lawId: law.id, lawSnapshot: { ...law }, tick: 20, hour: 20, place: 'field', activity: 'work', tags: ['work'] };
    expect(findDefenses(w, pc, c).some((d) => d.kind === 'condition')).toBe(true);
  });
  it('同じ行為に報酬を与える条文があれば矛盾を突く', () => {
    const w = createWorld(1);
    const law = enactLaw(w, { subject: 'anyone', condition: 'none', action: 'work', outcome: 'fine', amount: 100 });
    enactLaw(w, { subject: 'anyone', condition: 'none', action: 'harvest', outcome: 'reward', amount: 5 });
    const c = w.citizens.find((x) => x.job === 'farmer')!;
    const pc: PendingCase = { defendantId: c.id, lawId: law.id, lawSnapshot: { ...law }, tick: 10, hour: 10, place: 'field', activity: 'work', tags: ['work', 'harvest'] };
    expect(findDefenses(w, pc, c).some((d) => d.kind === 'conflict')).toBe(true);
  });
  it('廃止された条文では裁けない', () => {
    const w = createWorld(1);
    const law = enactLaw(w, { subject: 'anyone', condition: 'none', action: 'steal', outcome: 'jail', amount: 3 });
    repealLaw(w, law.id);
    const c = w.citizens[0];
    const pc: PendingCase = { defendantId: c.id, lawId: law.id, lawSnapshot: { ...law }, tick: 10, hour: 10, place: 'street', activity: 'steal', tags: ['steal'] };
    expect(findDefenses(w, pc, c)[0].kind).toBe('repealed');
  });
});

describe('放置と帰還レポート', () => {
  it('経過時間をティックに換算し、8時間で頭打ち', () => {
    expect(offlineTicks(0, 30 * 60_000)).toEqual({ ticks: 30, capped: false });
    expect(offlineTicks(0, 10 * 3600_000)).toEqual({ ticks: MAX_OFFLINE_TICKS, capped: true });
  });
  it('法案は時間で回復する', () => {
    const s = { tokens: 0, tokenAt: 0 };
    refreshTokens(s, TOKEN_MS * 2 + 5);
    expect(s.tokens).toBe(2);
  });
  it('レポートに指標の変化と注目事件が入る', () => {
    const w = createWorld(9);
    enactLaw(w, { subject: 'anyone', condition: 'none', action: 'steal_apple', outcome: 'exile', amount: 0 });
    const m = mark(w);
    advance(w, 24 * 10);
    const r = buildReport(w, m, false);
    expect(r.hours).toBe(240);
    expect(r.highlights.length).toBeGreaterThan(0);
    expect(new Set(r.news.map((n) => n.key)).size).toBe(r.news.length);
  });
});
