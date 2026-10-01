import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';

/**
 * Fails the build when the client bundle outgrows its budget.
 *
 * The phase 2 baseline scored 100 on Lighthouse mobile with LCP at 1.3s, but
 * it did so on a page with no images, no webfonts and no third-party scripts.
 * Every one of those is still to come. A score measured once and never
 * enforced decays silently, which is the failure this file exists to prevent:
 * the number is a budget, not a trophy.
 *
 * Sizes are raw, not compressed. Compression ratios move with content, so a
 * raw budget is the stricter and more stable signal.
 */
const DIR = 'dist/client/assets';
const HERO_DIR = 'public/hero';
const FONT_DIR = 'public/fonts';
const {budgets} = JSON.parse(readFileSync('perf-budget.json', 'utf8'));

const files = readdirSync(DIR).map((f) => ({
  name: f,
  kib: statSync(join(DIR, f)).size / 1024,
}));

const sum = (ext) =>
  files.filter((f) => f.name.endsWith(ext)).reduce((n, f) => n + f.kib, 0);

const js = sum('.js');
const css = sum('.css');
const largest = files.reduce((a, b) => (a.kib > b.kib ? a : b), {kib: 0, name: '-'});

// The bundle checks above cannot see an image, and photography is the thing that
// quietly ruins a score. These cover what the repo itself ships from public/:
// the hero (the page's LCP element) and the webfont. Product photographs are
// served from Shopify's CDN, resized per request, and are bounded by the
// responsive srcset in app/lib/images.ts rather than by a file in this repo.
const kib = (dir, ext) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(ext))
        .map((f) => ({name: f, kib: statSync(join(dir, f)).size / 1024}))
    : [];
const heroes = kib(HERO_DIR, '.avif');
const heroLargest = heroes.reduce((a, b) => (a.kib > b.kib ? a : b), {kib: 0, name: '-'});
const fontTotal = kib(FONT_DIR, '.woff2').reduce((n, f) => n + f.kib, 0);

const checks = [
  ['client JS total', js, budgets.totalClientJsKib],
  ['client CSS total', css, budgets.totalClientCssKib],
  [`largest asset (${largest.name})`, largest.kib, budgets.largestSingleAssetKib],
  [`largest hero AVIF (${heroLargest.name})`, heroLargest.kib, budgets.largestHeroImageKib],
  ['webfonts total', fontTotal, budgets.webfontsTotalKib],
];

let failed = false;
for (const [label, actual, limit] of checks) {
  const ok = actual <= limit;
  if (!ok) failed = true;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(34)} ${actual.toFixed(1).padStart(7)} KiB / ${limit} KiB`,
  );
}

if (failed) {
  console.error(
    '\nThe bundle is over budget. Either make it smaller, or raise the budget in\n' +
      'perf-budget.json deliberately and say why in the commit message.',
  );
  process.exit(1);
}
