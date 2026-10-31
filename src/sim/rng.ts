// シード付き乱数（mulberry32）。状態は World に保存して決定的に再現できるようにする。
export interface RngHolder {
  rng: number;
}

export function nextRandom(h: RngHolder): number {
  h.rng = (h.rng + 0x6d2b79f5) | 0;
  let t = h.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(h: RngHolder, min: number, max: number): number {
  return min + Math.floor(nextRandom(h) * (max - min + 1));
}

export function chance(h: RngHolder, p: number): boolean {
  return nextRandom(h) < p;
}

export function pick<T>(h: RngHolder, arr: readonly T[]): T {
  return arr[Math.floor(nextRandom(h) * arr.length)];
}

/** 正規分布っぽい値（3つの一様乱数の平均） */
export function bell(h: RngHolder, mean: number, spread: number): number {
  const u = (nextRandom(h) + nextRandom(h) + nextRandom(h)) / 3;
  return mean + (u - 0.5) * 2 * spread;
}
