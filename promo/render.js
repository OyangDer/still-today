// usage: node render.js <outdir> <fps> <workers> [duration] [scale]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const outDir = path.resolve(process.argv[2]);
const FPS = +process.argv[3] || 30;
const WORKERS = +process.argv[4] || 4;
const DUR = +process.argv[5] || 77.33;
const SCALE = +process.argv[6] || 1; // 0.5 for quick previews
const total = Math.round(DUR * FPS);
fs.mkdirSync(outDir, { recursive: true });

async function worker(w, browser) {
  const a = Math.floor(total * w / WORKERS), b = Math.floor(total * (w + 1) / WORKERS);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: SCALE });
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.goto('file://' + path.resolve(__dirname, 'index.html'));
  await page.evaluate(() => document.fonts.ready);
  // warm every font subset used anywhere in the film
  for (let t = 0; t < DUR; t += 0.5) await page.evaluate(t => render(t), t);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const seg = path.join(outDir, `seg${w}.mp4`);
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS), seg], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = a; f < b; f++) {
    await page.evaluate(t => render(t), f / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 94 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if ((f - a) % 200 === 0) console.log(`w${w} ${f - a}/${b - a} ${((Date.now() - t0) / Math.max(1, f - a)).toFixed(0)}ms/f`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await page.close();
  return seg;
}

(async () => {
  const browsers = await Promise.all(Array.from({ length: WORKERS }, () => chromium.launch()));
  const segs = await Promise.all(browsers.map((b, i) => worker(i, b)));
  await Promise.all(browsers.map(b => b.close()));
  fs.writeFileSync(path.join(outDir, 'list.txt'), segs.map(s => `file '${s}'`).join('\n'));
  console.log('done', segs);
})();
