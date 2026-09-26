const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Convert a PNG to WebP using Chrome's canvas encoder, optionally downscaling
async function convert(browser, srcPath, outPath, maxWidth) {
  const buf = fs.readFileSync(srcPath);
  const dataUrl = 'data:image/png;base64,' + buf.toString('base64');
  const page = await browser.newPage();
  const result = await page.evaluate(
    async (dataUrl, maxWidth) => {
      const img = new Image();
      img.src = dataUrl;
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
      let w = img.naturalWidth, h = img.naturalHeight;
      if (maxWidth && w > maxWidth) { h = Math.round((h * maxWidth) / w); w = maxWidth; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const webp = canvas.toDataURL('image/webp', 0.82);
      return { webp, origW: img.naturalWidth, origH: img.naturalHeight, newW: w, newH: h };
    },
    dataUrl, maxWidth
  );
  fs.writeFileSync(outPath, Buffer.from(result.webp.split(',')[1], 'base64'));
  const kbIn = (fs.statSync(srcPath).size / 1024).toFixed(0);
  const kbOut = (fs.statSync(outPath).size / 1024).toFixed(0);
  console.log(`${path.basename(srcPath)} ${result.origW}x${result.origH} (${kbIn}KB) -> ${path.basename(outPath)} ${result.newW}x${result.newH} (${kbOut}KB)`);
  await page.close();
}

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const dir = String.raw`C:\Users\Original\Desktop\backend GLM2\frontend\public\image`;
  await convert(browser, path.join(dir, 'hero-section.png'), path.join(dir, 'hero-section.webp'), 1600);
  await convert(browser, path.join(dir, 'course-page.png'), path.join(dir, 'course-page.webp'), 1200);
  await convert(browser, path.join(dir, 'logo.png'), path.join(dir, 'logo.webp'), null);
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
