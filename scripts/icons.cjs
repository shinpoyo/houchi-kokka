// SVGアイコンからPNGを書き出す（Playwrightのブラウザを使用）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '../public/icons/icon.svg'), 'utf8');
  const browser = await chromium.launch();
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<html><body style="margin:0;background:#1b1f2a">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(__dirname, `../public/icons/icon-${size}.png`) });
    await page.close();
  }
  await browser.close();
})();
