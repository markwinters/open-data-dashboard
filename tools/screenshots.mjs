#!/usr/bin/env node
/**
 * Renders the dashboard in a real browser: refreshes the README screenshot and
 * checks that no view scrolls the page body sideways at narrow widths.
 *
 * Run it against a built preview:
 *   npm run build && npm run preview &
 *   node tools/screenshots.mjs
 *
 * Pass --out <dir> to write the per-view captures somewhere for review.
 *
 * Uses Playwright's own Chromium. Set CHROMIUM_PATH to point at an existing
 * browser instead - useful in a sandbox that ships one and blocks the download.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outDir = outIndex === -1 ? null : args[outIndex + 1];
const base = process.env.PREVIEW_URL ?? 'http://localhost:4173/';

if (outDir) mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
let failures = 0;

async function open(context, tab) {
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.card, .empty-state', { timeout: 30000 });
  if (tab) await page.getByRole('tab', { name: tab }).click();
  await page.waitForTimeout(2500);
  return page;
}

// The README shot.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1180 }, deviceScaleFactor: 2 });
  const page = await open(context, null);
  await page.screenshot({ path: 'docs/overview.png' });
  console.log('wrote docs/overview.png');
  await context.close();
}

// Every view, at every width that changes the layout.
const views = [
  ['overzicht', null],
  ['analyse', 'Verbonden analyse'],
  ['paspoort', 'Voertuigpaspoort'],
];

for (const width of [420, 900, 1500]) {
  for (const [name, tab] of views) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
    const page = await open(context, tab);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    const ok = overflow <= 0;
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} @${width}px  horizontal overflow: ${overflow}px`);
    if (outDir) await page.screenshot({ path: `${outDir}/${name}-${width}.png`, fullPage: true });
    await context.close();
  }
}

await browser.close();
process.exit(failures > 0 ? 1 : 0);
