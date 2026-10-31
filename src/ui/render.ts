// 国土ビュー（Canvas 2D のドット絵）。シミュレーションの状態を読むだけで書き換えない。
import type { Citizen, Place, World } from '../sim/types';

export const VIEW_W = 320;
export const VIEW_H = 240;

interface Sprite {
  x: number;
  y: number;
  tx: number;
  ty: number;
  /** 去っていく国民（追放・流出）用 */
  leaving?: boolean;
  color?: string;
  gone?: boolean;
}

const ZONES: Record<Place, { x: number; y: number; w: number; h: number }> = {
  field: { x: 12, y: 14, w: 100, h: 70 },
  market: { x: 206, y: 16, w: 96, h: 58 },
  home: { x: 12, y: 160, w: 104, h: 66 },
  plaza: { x: 134, y: 104, w: 52, h: 40 },
  street: { x: 120, y: 86, w: 80, h: 70 },
  court: { x: 214, y: 100, w: 44, h: 34 },
  alley: { x: 136, y: 196, w: 46, h: 32 },
  jail: { x: 252, y: 176, w: 52, h: 46 },
};

const JOB_COLOR: Record<string, string> = {
  farmer: '#8bc34a',
  merchant: '#b388ff',
  guard: '#42a5f5',
  lawyer: '#eceff1',
  unemployed: '#a1887f',
};

function hash(n: number) {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 1274126177) >>> 0;
  return (x >>> 0) / 4294967296;
}

function targetFor(c: Citizen, tick: number): [number, number] {
  const z = ZONES[c.place];
  // 同じ場所でも人ごとに少しずつずらし、時間でゆっくり動かす
  const wander = Math.floor(tick / 2);
  const rx = hash(c.id * 31 + wander * (c.place === 'street' ? 7 : 1) * (c.activity === 'sleep' ? 0 : 1));
  const ry = hash(c.id * 17 + 3 + wander * (c.place === 'street' ? 5 : 1) * (c.activity === 'sleep' ? 0 : 1));
  return [z.x + 4 + rx * (z.w - 8), z.y + 6 + ry * (z.h - 10)];
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private sprites = new Map<number, Sprite>();
  private leavers: Sprite[] = [];
  private frame = 0;
  selectedId: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    canvas.width = VIEW_W * 3;
    canvas.height = VIEW_H * 3;
  }

  /** ティックが進んだら目的地を更新し、いなくなった国民を国境へ歩かせる */
  sync(w: World) {
    const alive = new Set<number>();
    for (const c of w.citizens) {
      alive.add(c.id);
      const [tx, ty] = targetFor(c, w.tick);
      const s = this.sprites.get(c.id);
      if (!s) {
        const fromBorder = c.foreigner && w.tick > 10;
        const start: [number, number] = fromBorder ? [VIEW_W + 4, 118] : [tx, ty];
        this.sprites.set(c.id, { x: start[0], y: start[1], tx, ty });
      } else {
        s.tx = tx;
        s.ty = ty;
      }
    }
    for (const [id, s] of this.sprites) {
      if (!alive.has(id)) {
        this.sprites.delete(id);
        if (this.leavers.length < 40) this.leavers.push({ ...s, tx: VIEW_W + 10, ty: 118 + (hash(id) - 0.5) * 10, leaving: true });
      }
    }
  }

  pick(w: World, px: number, py: number): Citizen | null {
    let best: Citizen | null = null;
    let bd = 9 * 9;
    for (const c of w.citizens) {
      const s = this.sprites.get(c.id);
      if (!s || (c.activity === 'sleep' && c.status === 'free')) continue;
      const d = (s.x - px) ** 2 + (s.y - 3 - py) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  draw(w: World, dt: number) {
    this.frame++;
    const g = this.ctx;
    g.setTransform(3, 0, 0, 3, 0, 0);
    g.imageSmoothingEnabled = false;
    const hour = w.tick % 24;
    this.drawGround(w);
    this.drawBuildings(w);

    // 国民
    const list = [...w.citizens].sort((a, b) => (this.sprites.get(a.id)?.y ?? 0) - (this.sprites.get(b.id)?.y ?? 0));
    for (const c of list) {
      const s = this.sprites.get(c.id);
      if (!s) continue;
      const speed = (c.crawling ? 9 : 34) * dt;
      const dx = s.tx - s.x;
      const dy = s.ty - s.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.5) {
        const k = Math.min(1, speed / d);
        s.x += dx * k;
        s.y += dy * k;
      }
      if (c.activity === 'sleep' && c.status === 'free' && d < 2) continue; // 家の中で寝ている
      this.drawCitizen(c, s, d > 0.8);
    }
    for (const s of this.leavers) {
      const dx = s.tx - s.x;
      const dy = s.ty - s.y;
      const d = Math.hypot(dx, dy);
      if (d < 1) {
        s.gone = true;
        continue;
      }
      const k = Math.min(1, (26 * dt) / d);
      s.x += dx * k;
      s.y += dy * k;
      g.fillStyle = '#ef9a9a';
      g.fillRect(Math.round(s.x) - 1, Math.round(s.y) - 6, 3, 6);
      g.fillStyle = '#f5d0a9';
      g.fillRect(Math.round(s.x) - 1, Math.round(s.y) - 8, 3, 2);
    }
    this.leavers = this.leavers.filter((s) => !s.gone);

    this.drawNight(w, hour);
    this.drawSleepZ(w, hour);
  }

  private drawGround(w: World) {
    const g = this.ctx;
    g.fillStyle = '#5b8c3a';
    g.fillRect(0, 0, VIEW_W, VIEW_H);
    // 道
    g.fillStyle = '#c8b27a';
    g.fillRect(0, 112, VIEW_W, 14);
    g.fillRect(152, 0, 16, VIEW_H);
    g.fillRect(60, 84, 10, 80);
    g.fillRect(250, 74, 10, 104);
    // 国境の門
    g.fillStyle = '#6d4c41';
    g.fillRect(VIEW_W - 6, 104, 6, 4);
    g.fillRect(VIEW_W - 6, 130, 6, 4);
    // 畑
    const f = ZONES.field;
    g.fillStyle = '#7a5a33';
    g.fillRect(f.x, f.y, f.w, f.h);
    const crop = Math.min(1, w.food / Math.max(1, w.citizens.length * 6));
    for (let r = 0; r < 6; r++) {
      g.fillStyle = r % 2 ? '#9ccc65' : '#7cb342';
      for (let x = f.x + 3; x < f.x + f.w - 3; x += 4) {
        if (hash(x * 13 + r) < 0.35 + crop * 0.6) g.fillRect(x, f.y + 6 + r * 11, 2, 3);
      }
    }
    // リンゴの木
    for (let i = 0; i < 4; i++) {
      const x = f.x + 10 + i * 26;
      const y = f.y + f.h + 6;
      g.fillStyle = '#5d4037';
      g.fillRect(x, y, 2, 5);
      g.fillStyle = '#2e7d32';
      g.fillRect(x - 4, y - 7, 10, 8);
      g.fillStyle = '#e53935';
      if (crop > 0.3) g.fillRect(x - 2, y - 5, 2, 2);
      if (crop > 0.6) g.fillRect(x + 3, y - 3, 2, 2);
    }
    // 広場
    const p = ZONES.plaza;
    g.fillStyle = '#d7ccc8';
    g.fillRect(p.x, p.y, p.w, p.h);
    g.fillStyle = '#90a4ae';
    g.fillRect(p.x + p.w / 2 - 5, p.y + p.h / 2 - 5, 10, 10);
    g.fillStyle = '#4fc3f7';
    g.fillRect(p.x + p.w / 2 - 3, p.y + p.h / 2 - 3, 6, 6);
    // 法典の石碑（条文の数だけ刻み）
    g.fillStyle = '#9e9e9e';
    g.fillRect(p.x + 3, p.y + 3, 8, 11);
    g.fillStyle = '#424242';
    for (let i = 0; i < Math.min(5, w.laws.length); i++) g.fillRect(p.x + 4, p.y + 5 + i * 2, 6, 1);
  }

  private drawBuildings(w: World) {
    const g = this.ctx;
    const lv = w.civLevel;
    // 家
    const h = ZONES.home;
    const houses = Math.min(18, 4 + Math.floor(w.citizens.length / 8));
    for (let i = 0; i < houses; i++) {
      const col = i % 6;
      const row = Math.floor(i / 6);
      const x = h.x + 2 + col * 17;
      const y = h.y + 4 + row * 21;
      g.fillStyle = lv >= 4 ? '#bcaaa4' : lv >= 2 ? '#a1887f' : '#8d6e63';
      g.fillRect(x, y + 5, 13, 10);
      g.fillStyle = lv >= 4 ? '#1565c0' : lv >= 2 ? '#c62828' : '#a1887f';
      g.fillRect(x - 1, y + 1, 15, 5);
      g.fillStyle = '#3e2723';
      g.fillRect(x + 5, y + 10, 3, 5);
    }
    // 市場
    const m = ZONES.market;
    const stalls = lv >= 2 ? 5 : 2;
    for (let i = 0; i < stalls; i++) {
      const x = m.x + 4 + (i % 3) * 32;
      const y = m.y + 4 + Math.floor(i / 3) * 28;
      g.fillStyle = '#6d4c41';
      g.fillRect(x, y + 6, 22, 8);
      g.fillStyle = i % 2 ? '#ffca28' : '#ef5350';
      g.fillRect(x - 1, y, 24, 6);
      g.fillStyle = '#fff';
      for (let k = 0; k < 4; k++) g.fillRect(x + 1 + k * 6, y, 3, 6);
    }
    // 牢屋・詰所
    const j = ZONES.jail;
    g.fillStyle = '#616161';
    g.fillRect(j.x, j.y, j.w, j.h);
    g.fillStyle = '#424242';
    g.fillRect(j.x + 2, j.y + 2, j.w - 4, j.h - 4);
    g.fillStyle = '#9e9e9e';
    for (let x = j.x + 4; x < j.x + j.w - 2; x += 5) g.fillRect(x, j.y + 2, 1, j.h - 4);
    // 裁判所（文明Lv3〜）
    const c = ZONES.court;
    if (lv >= 3) {
      g.fillStyle = '#eceff1';
      g.fillRect(c.x, c.y + 6, c.w, c.h - 6);
      g.fillStyle = '#b0bec5';
      g.fillRect(c.x - 2, c.y, c.w + 4, 7);
      g.fillStyle = '#90a4ae';
      for (let x = c.x + 3; x < c.x + c.w - 2; x += 8) g.fillRect(x, c.y + 8, 3, c.h - 9);
      g.fillStyle = '#ffd54f';
      g.fillRect(c.x + c.w / 2 - 2, c.y + 1, 4, 4);
    } else {
      g.strokeStyle = '#3e6b25';
      g.setLineDash([2, 2]);
      g.strokeRect(c.x + 0.5, c.y + 0.5, c.w, c.h);
      g.setLineDash([]);
    }
    // 城（文明Lv4〜）
    if (lv >= 4) {
      g.fillStyle = '#9e9e9e';
      g.fillRect(126, 20, 22, 30);
      g.fillRect(124, 16, 4, 6);
      g.fillRect(136, 16, 4, 6);
      g.fillRect(146, 16, 4, 6);
      g.fillStyle = lv >= 5 ? '#ffd54f' : '#e53935';
      g.fillRect(137, 6, 1, 10);
      g.fillRect(138, 6, 6, 4);
    }
    // 路地裏の闇市（地下経済があるときだけ明るい）
    const a = ZONES.alley;
    const ug = w.yesterday.underground + w.today.underground;
    g.fillStyle = '#33402b';
    g.fillRect(a.x, a.y, a.w, a.h);
    if (ug > 0) {
      g.fillStyle = '#4e342e';
      g.fillRect(a.x + 4, a.y + 6, 14, 6);
      g.fillRect(a.x + 26, a.y + 16, 14, 6);
      g.fillStyle = '#ffb300';
      if (this.frame % 40 < 30) g.fillRect(a.x + 10, a.y + 3, 2, 2);
      g.fillRect(a.x + 32, a.y + 13, 2, 2);
    }
  }

  private drawCitizen(c: Citizen, s: Sprite, moving: boolean) {
    const g = this.ctx;
    const x = Math.round(s.x);
    const y = Math.round(s.y);
    const body = JOB_COLOR[c.job] ?? '#fff';
    const skin = c.foreigner ? '#d7a77a' : '#f5d0a9';
    if (this.selectedId === c.id) {
      g.strokeStyle = '#ffeb3b';
      g.strokeRect(x - 4.5, y - 11.5, 9, 13);
    }
    if (c.crawling && c.activity !== 'jail') {
      // ほふく前進
      const wob = moving && this.frame % 20 < 10 ? 1 : 0;
      g.fillStyle = body;
      g.fillRect(x - 3, y - 2, 6, 2);
      g.fillStyle = skin;
      g.fillRect(x + 3, y - 3, 2, 2);
      g.fillStyle = '#5d4037';
      g.fillRect(x - 4, y - 1 + wob, 1, 1);
      g.fillRect(x + 1, y - wob, 1, 1);
      return;
    }
    const step = moving && this.frame % 16 < 8 ? 1 : 0;
    g.fillStyle = '#3e2723';
    g.fillRect(x - 1, y - 2, 1, 2 - step);
    g.fillRect(x + 1, y - 2, 1, 1 + step);
    g.fillStyle = body;
    g.fillRect(x - 1, y - 6, 3, 4);
    g.fillStyle = skin;
    g.fillRect(x - 1, y - 8, 3, 2);
    if (c.job === 'guard') {
      g.fillStyle = '#90a4ae';
      g.fillRect(x - 1, y - 9, 3, 1);
    } else if (c.job === 'lawyer') {
      g.fillStyle = '#212121';
      g.fillRect(x, y - 6, 1, 3);
    } else if (c.foreigner) {
      g.fillStyle = '#ff7043';
      g.fillRect(x - 2, y - 9, 5, 1);
    }
    if (c.insomnia > 3) {
      g.fillStyle = '#4a148c';
      g.fillRect(x - 1, y - 7, 3, 1);
    }
    if (c.silent && this.frame % 90 < 60) this.bubble(x, y, '…');
    else if (c.activity === 'blackmarket') this.bubble(x, y, '$');
    else if (c.activity === 'steal' || c.activity === 'steal_apple' || c.activity === 'steal_pear') this.bubble(x, y, '!');
    else if (c.activity === 'assault') this.bubble(x, y, '#');
  }

  private bubble(x: number, y: number, t: string) {
    const g = this.ctx;
    g.fillStyle = '#fff';
    g.fillRect(x - 3, y - 15, 7, 6);
    g.fillStyle = '#000';
    g.font = '6px monospace';
    g.textBaseline = 'top';
    g.fillText(t, x - 2, y - 15);
  }

  private drawNight(w: World, hour: number) {
    const g = this.ctx;
    let dark = 0;
    if (hour >= 20 || hour <= 4) dark = 0.55;
    else if (hour === 5 || hour === 19) dark = 0.3;
    else if (hour === 18 || hour === 6) dark = 0.15;
    if (dark === 0) return;
    g.fillStyle = `rgba(10,15,45,${dark})`;
    g.fillRect(0, 0, VIEW_W, VIEW_H);
    // 夜回りの衛兵のランタン
    g.globalCompositeOperation = 'lighter';
    for (const c of w.citizens) {
      if (c.job !== 'guard' || c.activity !== 'work') continue;
      const s = this.sprites.get(c.id);
      if (!s) continue;
      g.fillStyle = 'rgba(255,200,80,0.18)';
      g.beginPath();
      g.arc(s.x, s.y - 4, 12, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }

  private drawSleepZ(w: World, hour: number) {
    if (!(hour >= 22 || hour <= 6)) return;
    const g = this.ctx;
    const sleepers = w.citizens.filter((c) => c.activity === 'sleep').length;
    if (sleepers === 0) return;
    g.fillStyle = '#e1f5fe';
    g.font = '7px monospace';
    const n = Math.min(6, Math.ceil(sleepers / 8));
    for (let i = 0; i < n; i++) {
      const t = (this.frame + i * 23) % 90;
      g.fillText('z', ZONES.home.x + 8 + i * 17, ZONES.home.y + 2 - t / 12);
    }
  }
}
