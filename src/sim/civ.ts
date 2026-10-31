export interface CivLevel {
  level: number;
  name: string;
  points: number;
  slots: number;
  unlocks: string;
}

export const CIV_LEVELS: CivLevel[] = [
  { level: 1, name: '集落', points: 0, slots: 3, unlocks: '基本の語彙・条文3つ' },
  { level: 2, name: '村', points: 120, slots: 5, unlocks: '商人・市場・路上・売買・暴力・課税・死刑、条文5つ' },
  { level: 3, name: '町', points: 450, slots: 6, unlocks: '裁判所と弁護士、訴えた・休日に、条文6つ' },
  { level: 4, name: '都市', points: 1300, slots: 8, unlocks: '貴族・発言した、条文8つ' },
  { level: 5, name: '国家', points: 3200, slots: 12, unlocks: '外国人・入国した、条文12' },
];

export function civInfo(level: number): CivLevel {
  return CIV_LEVELS[Math.max(0, Math.min(CIV_LEVELS.length - 1, level - 1))];
}

export function nextCiv(level: number): CivLevel | null {
  return CIV_LEVELS[level] ?? null;
}
