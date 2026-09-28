// Rendu PDF -> PNG (pour OCR Vision). Usage: node render-pdf.mjs <pdf> <outdir> [scale]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(process.cwd() + '/package.json');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs');
const { createCanvas } = require('@napi-rs/canvas');

const [pdfPath, outDir, scaleArg] = process.argv.slice(2);
const scale = Number(scaleArg) || 2;

const data = new Uint8Array(fs.readFileSync(pdfPath));
const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
fs.mkdirSync(outDir, { recursive: true });

for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const vp = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const out = path.join(outDir, `p-${String(i).padStart(2, '0')}.png`);
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`page ${i}/${doc.numPages} -> ${out}`);
}
console.log('DONE', doc.numPages, 'pages');
