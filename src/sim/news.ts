// 1日の統計から「ひとことニュース」（悪法のカオスの兆候など）を作る。
import { pick } from './rng';
import type { DayStats, World } from './types';

function pushNews(w: World, key: string, text: string, score: number, cooldownDays = 4) {
  const recent = w.news.find((n) => n.key === key && w.tick - n.tick < cooldownDays * 24);
  if (recent) return;
  w.news.push({ tick: w.tick, key, text, score });
  if (w.news.length > 200) w.news.splice(0, w.news.length - 200);
}

export function dailyNews(w: World, s: DayStats) {
  const pop = Math.max(1, w.citizens.length);
  const active = Math.max(1, s.activeTicks);
  const crawl = s.crawlTicks / active;
  const insomnia = s.insomniaTicks / Math.max(1, pop * 7);
  const silent = s.silentTicks / active;
  const under = s.trade + s.underground > 0 ? s.underground / (s.trade + s.underground) : 0;

  if (crawl > 0.3)
    pushNews(w, 'crawl', pick(w, [
      `ほふく前進が国民的な移動手段に。膝当ての売上が前年比${Math.round(crawl * 900)}%を記録。`,
      `「立って歩くのは野蛮」— 国民の${Math.round(crawl * 100)}%が地面を這って通勤している。`,
      '這いすぎた国民の間で腰痛が流行。畑の収穫量は目に見えて落ちている。',
    ]), 40);
  if (insomnia > 0.15)
    pushNews(w, 'insomnia', pick(w, [
      '不眠国家。夜中の広場は目の下にクマを作った国民であふれている。',
      '眠れない国民が深夜に集まり「眠らない会」を結成。幸福度は下がる一方だ。',
    ]), 38);
  if (silent > 0.3)
    pushNews(w, 'silent', pick(w, [
      '発言を恐れた国民の間で筆談とジェスチャーが大流行。広場は静まり返っている。',
      '国民は「…」としか言わなくなった。手話教室には長い行列ができている。',
    ]), 36);
  if (under > 0.4)
    pushNews(w, 'underground', pick(w, [
      `地下経済が表の経済の${Math.round((under / Math.max(0.01, 1 - under)) * 100)}%に達した。路地裏の闇市は昼でもにぎわっている。`,
      '商人たちは店をたたみ、路地裏で「物々交換」と称した取引を始めた。',
    ]), 35);
  if (s.exiles >= Math.max(3, pop * 0.05))
    pushNews(w, 'exile', `国境に追放者の行列。この日だけで${s.exiles}人が国を追われた。`, 32, 2);
  if (s.nightCrimes >= 5 && s.nightCrimes > s.crimes * 0.6)
    pushNews(w, 'night-crime', '夜の街は無法地帯に。衛兵の夜回りが減り、泥棒たちは夜にだけ働くようになった。', 30);
  if (w.foodPrice >= 12) pushNews(w, 'famine', `食料が不足し、パン1つが${w.foodPrice}Gに高騰。飢えた国民がリンゴの木に群がっている。`, 30, 3);
  if (s.unpaidRewards > 3) pushNews(w, 'bankrupt', `国庫が空っぽになり、法で約束された報酬が${s.unpaidRewards}件も未払いに。神の信用は地に落ちた。`, 28, 3);
  if (s.lawsuits > pop * 0.1) pushNews(w, 'litigation', `訴訟件数が1日${s.lawsuits}件に。弁護士の事務所の前に行列ができている。`, 26);
  if (s.crimes === 0 && pop > 10) pushNews(w, 'peace', '犯罪ゼロの1日。衛兵たちは暇そうにあくびをしていた。', 12, 6);
  if (s.births >= 4) pushNews(w, 'babyboom', `ベビーブーム到来。この日${s.births}人の新しい国民が誕生した。`, 14, 5);
  if (s.immigrants >= 4) pushNews(w, 'immigrants', `移民が続々と到着。この日だけで${s.immigrants}人が入国した。`, 12, 5);
  if (s.crimes > pop * 0.3) pushNews(w, 'crime-wave', `犯罪の波が国を襲う。1日で${s.crimes}件の犯罪が起きた。`, 24, 3);
  if (s.rewards > 300) pushNews(w, 'reward-spree', `国が1日に${Math.round(s.rewards)}Gもの報酬をばらまいた。国民は報酬の出る行為に殺到している。`, 22, 3);
}
