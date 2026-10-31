// セーブデータ（localStorage）と放置時間の計算
import type { Report } from '../sim/report';
import type { World } from '../sim/types';
import { SAVE_VERSION } from '../sim/world';

export const SAVE_KEY = 'houchi-kokka/save/v1';
/** 現実1分 ＝ ゲーム内1時間 */
export const REAL_MS_PER_TICK = 60_000;
/** 放置の上限：8時間（ゲーム内20日） */
export const MAX_OFFLINE_TICKS = 8 * 60;
/** 法案（立法できる回数）の回復間隔と上限 */
export const TOKEN_MS = 3 * 60_000;
export const MAX_TOKENS = 3;

export interface PastNation {
  name: string;
  days: number;
  generation: number;
  cases: number;
  peak: number;
  end: string;
}

export interface SaveData {
  version: number;
  world: World;
  lastSavedAt: number;
  tokens: number;
  tokenAt: number;
  speed: number;
  archive: Report[];
  pastNations: PastNation[];
  seenIntro: boolean;
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (!data || data.version !== SAVE_VERSION || !data.world) return null;
    return data;
  } catch {
    return null;
  }
}

export function writeSave(data: SaveData): boolean {
  try {
    data.lastSavedAt = Date.now();
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* 保存できない環境では何もしない */
  }
}

/** 経過時間から、まとめて進めるティック数を求める */
export function offlineTicks(lastSavedAt: number, now: number): { ticks: number; capped: boolean } {
  const raw = Math.floor(Math.max(0, now - lastSavedAt) / REAL_MS_PER_TICK);
  return { ticks: Math.min(raw, MAX_OFFLINE_TICKS), capped: raw > MAX_OFFLINE_TICKS };
}

/** 法案トークンを時間経過で回復させる */
export function refreshTokens(s: Pick<SaveData, 'tokens' | 'tokenAt'>, now: number) {
  if (s.tokens >= MAX_TOKENS) {
    s.tokenAt = now;
    return;
  }
  const gained = Math.floor((now - s.tokenAt) / TOKEN_MS);
  if (gained > 0) {
    s.tokens = Math.min(MAX_TOKENS, s.tokens + gained);
    s.tokenAt = s.tokens >= MAX_TOKENS ? now : s.tokenAt + gained * TOKEN_MS;
  }
}
