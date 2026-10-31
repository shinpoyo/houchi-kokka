// 裁判とAI弁護士。弁護士は条文の構造から機械的に判定できる「穴」を突く。
import { chance, nextRandom, pick } from './rng';
import { lawApplies, lawText, timeContext } from './law';
import type { Citizen, DefenseKind, PendingCase, World } from './types';
import type { ActionId } from './vocab';

export interface Defense {
  kind: DefenseKind;
  base: number;
  argument: string;
}

export interface Verdict {
  acquitted: boolean;
  lawyer: Citizen | null;
  defense: Defense | null;
  reduced: boolean;
  judgeOnly: boolean;
}

const OBJECT_ARGS: Partial<Record<ActionId, [number, string[]]>> = {
  steal_apple: [0.38, ['盗まれたのはリンゴではなく梨である', 'あれはリンゴではなく「赤い丸い何か」である', '被告はリンゴを盗んだのではなく、リンゴに盗まれたのだ']],
  steal: [0.15, ['被告は盗んだのではなく、無期限で借りただけである', '持ち主が「どうぞ」と言ったように聞こえた']],
  assault: [0.18, ['あれは暴力ではなく、激しめの握手である', '正当防衛であった']],
  work: [0.3, ['被告がしていたのは労働ではなく趣味である', 'あれは労働ではなく、ボランティア活動である']],
  harvest: [0.3, ['被告は収穫したのではなく、作物の散歩を手伝っただけである', 'あれは収穫ではなく、家庭菜園の手入れである']],
  trade: [0.3, ['あれは売買ではなく、贈り物の交換である', '代金ではなく「お気持ち」を受け取っただけである']],
  walk: [0.35, ['被告は歩いていたのではなく、早めの小走りをしていた', '片足が常に地面から浮いていたので、歩行ではない']],
  sleep: [0.35, ['被告は眠っていたのではなく、目を閉じて瞑想していた', 'いびきは寝言ではなく、詩の朗読である']],
  speak: [0.35, ['あれは発言ではなく独り言である', '被告は歌っていたのであって、発言はしていない']],
  sue: [0.2, ['訴えたのではなく、相談しただけである']],
  immigrate: [0.25, ['被告は入国したのではなく、国境線の上で昼寝をしていたら国境が動いたのだ']],
};

const SUBJECT_JOB = new Set(['farmer', 'merchant', 'guard', 'lawyer']);
const JOB_NAME: Record<string, string> = { farmer: '農民', merchant: '商人', guard: '衛兵', lawyer: '弁護士', unemployed: '無職' };

export function jobName(job: string): string {
  return JOB_NAME[job] ?? job;
}

/** 弁護士が使える主張の一覧（強い順ではない） */
export function findDefenses(w: World, c: PendingCase, defendant: Citizen): Defense[] {
  const out: Defense[] = [];
  const current = w.laws.find((l) => l.id === c.lawId);
  const law = c.lawSnapshot;
  const t = timeContext(c.tick);

  if (!current) {
    out.push({ kind: 'repealed', base: 0.97, argument: 'その条文はすでに廃止されている' });
  } else if (!lawApplies(current, defendant, c.tags, t, c.place)) {
    out.push({ kind: 'retroactive', base: 0.9, argument: '改正後の条文では被告の行為は罪にあたらない。法は遡って適用できない' });
  }

  // 法の衝突：同じ行為に報酬を与える条文がある
  for (const other of w.laws) {
    if (other.id === law.id || other.outcome !== 'reward') continue;
    if (lawApplies(other, defendant, c.tags, t, c.place)) {
      out.push({ kind: 'conflict', base: 0.66, argument: `同じ行為に「${lawText(other)}」とある。国は罰と報酬を同時に与えられない` });
      break;
    }
  }

  // 条件の境界
  if (law.condition === 'night' && (t.hour === 20 || t.hour === 4)) {
    out.push({ kind: 'condition', base: 0.6, argument: t.hour === 20 ? '犯行時刻は夕暮れであり、まだ夜間ではない' : '犯行時刻は明け方であり、もはや夜間ではない' });
  } else if (law.condition === 'day' && (t.hour === 6 || t.hour === 17)) {
    out.push({ kind: 'condition', base: 0.6, argument: t.hour === 6 ? '日の出前であり、日中とは言えない' : '日は傾いており、日中とは言えない' });
  } else if (law.condition === 'market' || law.condition === 'street') {
    out.push({ kind: 'condition', base: 0.28, argument: law.condition === 'market' ? '現場は市場ではなく、市場の入口の外側だった' : '現場は路上ではなく、私有地の庭先だった' });
  } else if (law.condition === 'holiday' && (t.hour === 0 || t.hour === 23)) {
    out.push({ kind: 'condition', base: 0.5, argument: '日付が変わる前（後）であり、休日ではなかった' });
  }

  // 目的語・行為のずれ
  const obj = OBJECT_ARGS[law.action];
  if (obj) out.push({ kind: 'object', base: obj[0], argument: pick(w, obj[1]) });

  // 主語のずれ
  if (SUBJECT_JOB.has(law.subject) && (defendant.formerJob === law.subject || c.tick - defendant.jobSince < 72)) {
    out.push({
      kind: 'subject',
      base: 0.55,
      argument: defendant.formerJob === law.subject && defendant.job !== law.subject
        ? `被告はすでに${jobName(law.subject)}を辞めた元${jobName(law.subject)}である`
        : `被告は転職したばかりで、まだ正式な${jobName(law.subject)}ではなかった`,
    });
  } else if (law.subject === 'noble' || law.subject === 'poor') {
    const n = w.citizens.length;
    const boundary = law.subject === 'noble' ? n * 0.1 : n * 0.8;
    if (Math.abs(defendant.wealthRank - boundary) <= Math.max(2, n * 0.05)) {
      out.push({ kind: 'subject', base: 0.45, argument: law.subject === 'noble' ? '被告は貴族ではなく、ちょっとした小金持ちにすぎない' : '被告は貧民ではなく、「つつましい中流」である' });
    }
  } else if (law.subject === 'foreigner') {
    out.push({ kind: 'subject', base: 0.22, argument: '被告は書類上は外国人でも、心はこの国の民である' });
  }

  out.push({ kind: 'vague', base: 0.08, argument: '条文の文言はあいまいで、被告の行為を明確に指していない' });
  return out;
}

export function pickLawyer(w: World, defendant: Citizen): Citizen | null {
  const lawyers = w.citizens.filter((x) => x.job === 'lawyer' && x.status === 'free' && x.id !== defendant.id);
  if (lawyers.length === 0) return null;
  lawyers.sort((a, b) => b.intelligence + b.wins * 3 - (a.intelligence + a.wins * 3));
  // 弁護費用を払えれば腕利き、払えなければ国選（ランダム・確率で付く）
  if (defendant.money >= 15) return lawyers[Math.min(lawyers.length - 1, Math.floor(nextRandom(w) * 2))];
  return chance(w, 0.45) ? pick(w, lawyers) : null;
}

export function judge(w: World, c: PendingCase, defendant: Citizen, withCourt: boolean): Verdict {
  const defenses = findDefenses(w, c, defendant);
  const judgeOnly = defenses.find((d) => d.kind === 'repealed' || d.kind === 'retroactive') ?? null;
  const lawyer = withCourt ? pickLawyer(w, defendant) : null;

  if (!lawyer) {
    if (judgeOnly && chance(w, 0.7)) return { acquitted: true, lawyer: null, defense: judgeOnly, reduced: false, judgeOnly: true };
    return { acquitted: false, lawyer: null, defense: null, reduced: false, judgeOnly: false };
  }

  defenses.sort((a, b) => b.base - a.base);
  const best = defenses[0];
  const skill = 0.55 + lawyer.intelligence / 220 + Math.min(0.2, lawyer.wins * 0.01);
  const win = Math.min(0.97, best.base * skill);
  if (chance(w, win)) return { acquitted: true, lawyer, defense: best, reduced: false, judgeOnly: false };
  return { acquitted: false, lawyer, defense: best, reduced: chance(w, 0.35), judgeOnly: false };
}
