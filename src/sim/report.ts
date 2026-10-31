// 帰還時の判例レポート
import type { GameEvent, NewsItem, Snapshot, World } from './types';
import { snapshot } from './world';

/** 放置を始めた時点の記録 */
export interface Mark {
  tick: number;
  snap: Snapshot;
  cases: number;
  acquittals: number;
  born: number;
  died: number;
  exiled: number;
}

export interface Report {
  fromTick: number;
  toTick: number;
  hours: number;
  before: Snapshot;
  after: Snapshot;
  highlights: GameEvent[];
  news: NewsItem[];
  counts: { cases: number; acquittals: number; born: number; died: number; exiled: number };
  capped: boolean;
}

export function mark(w: World): Mark {
  return {
    tick: w.tick,
    snap: snapshot(w),
    cases: w.totals.cases,
    acquittals: w.totals.acquittals,
    born: w.totals.born,
    died: w.totals.died,
    exiled: w.totals.exiled,
  };
}

/** 面白さスコアの高い出来事を、種類がかたよらないように選ぶ */
export function pickHighlights(events: GameEvent[], max = 5): GameEvent[] {
  const sorted = [...events].sort((a, b) => b.score - a.score);
  const out: GameEvent[] = [];
  const perKind = new Map<string, number>();
  for (const e of sorted) {
    if (e.score < 8) break;
    const n = perKind.get(e.kind) ?? 0;
    if (n >= (e.kind === 'verdict' ? 3 : 2)) continue;
    perKind.set(e.kind, n + 1);
    out.push(e);
    if (out.length >= max) break;
  }
  return out.sort((a, b) => a.tick - b.tick);
}

export function buildReport(w: World, m: Mark, capped: boolean): Report {
  const events = w.events.filter((e) => e.tick > m.tick);
  const seen = new Set<string>();
  const news = w.news
    .filter((n) => n.tick > m.tick)
    .sort((a, b) => b.score - a.score)
    .filter((n) => !seen.has(n.key) && seen.add(n.key))
    .slice(0, 4);
  return {
    fromTick: m.tick,
    toTick: w.tick,
    hours: w.tick - m.tick,
    before: m.snap,
    after: snapshot(w),
    highlights: pickHighlights(events, 5),
    news,
    counts: {
      cases: w.totals.cases - m.cases,
      acquittals: w.totals.acquittals - m.acquittals,
      born: w.totals.born - m.born,
      died: w.totals.died - m.died,
      exiled: w.totals.exiled - m.exiled,
    },
    capped,
  };
}
