// バランス調整用：いくつかの法典で何日か回して指標を表示する
import { createWorld, advance, enactLaw, avgHappiness } from '../src/sim/world';
import type { LawDraft } from '../src/sim/law';
import { undergroundShare } from '../src/sim/world';

const scenarios: Record<string, LawDraft[]> = {
  none: [],
  walkban: [{ subject: 'anyone', condition: 'none', action: 'walk', outcome: 'fine', amount: 50 }],
  appleExile: [{ subject: 'anyone', condition: 'none', action: 'steal_apple', outcome: 'exile', amount: 0 }],
  sleepFine: [{ subject: 'anyone', condition: 'none', action: 'sleep', outcome: 'fine', amount: 100 }],
  nightWork: [{ subject: 'anyone', condition: 'night', action: 'work', outcome: 'fine', amount: 100 }, { subject: 'anyone', condition: 'none', action: 'steal', outcome: 'jail', amount: 3 }],
  stealOnly: [{ subject: 'anyone', condition: 'none', action: 'steal', outcome: 'jail', amount: 3 }],
  tradeTax100: [{ subject: 'anyone', condition: 'none', action: 'trade', outcome: 'tax', amount: 100 }],
  sane: [
    { subject: 'anyone', condition: 'none', action: 'steal', outcome: 'jail', amount: 3 },
    { subject: 'merchant', condition: 'none', action: 'trade', outcome: 'tax', amount: 20 },
    { subject: 'anyone', condition: 'none', action: 'assault', outcome: 'jail', amount: 10 },
  ],
};
const days = Number(process.argv[2] ?? 30);
for (const [name, laws] of Object.entries(scenarios)) {
  const w = createWorld(12345);
  if (name === 'tradeTax100') w.civLevel = 2;
  for (const l of laws) enactLaw(w, l);
  const rows: string[] = [];
  for (let d = 1; d <= days; d++) {
    advance(w, 24);
    if (d % 5 === 0 || d === 1) {
      const y = w.yesterday;
      const jobs = ['farmer','merchant','guard','lawyer','unemployed'].map(j => w.citizens.filter(c=>c.job===j).length).join('/');
      rows.push(`d${d} pop${w.citizens.length} h${avgHappiness(w).toFixed(0)} gdp${y.gdp.toFixed(0)} tr${w.treasury.toFixed(0)} food${w.food.toFixed(0)}@${w.foodPrice} crimes${y.crimes} arr${y.arrests} saf${w.safety} civ${w.civLevel}(${w.civPoints.toFixed(0)}) crawl${(y.crawlTicks/Math.max(1,y.activeTicks)*100).toFixed(0)}% ins${y.insomniaTicks} ug${undergroundShare(y)}% jobs${jobs} ex${w.totals.exiled} died${w.totals.died}`);
    }
  }
  console.log(`== ${name}`); rows.forEach(r=>console.log(r));
  const top = [...w.events].sort((a,b)=>b.score-a.score).slice(0,3).map(e=>`  [${e.score.toFixed(0)}] ${e.text}`);
  console.log(top.join('\n'));
  console.log('  news:', w.news.map(n=>n.key).join(','));
}
