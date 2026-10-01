import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

/**
 * The site has to be indexable. These checks fail if anything blocks crawlers:
 * a Disallow rule, a robots meta tag, or an X-Robots-Tag header.
 */
const tracked = execFileSync('git', ['ls-files', '-z'], {encoding: 'utf8'})
  .split('\0')
  .filter((f) => /^(app|public|server)\//.test(f) || ['server.ts', 'vercel.json'].includes(f))
  .filter((f) => !/\.(png|jpe?g|webp|avif|woff2?|ico)$/i.test(f));

describe('discoverability', () => {
  it('robots.txt allows everything', () => {
    const robots = readFileSync('public/robots.txt', 'utf8');
    expect(robots).toMatch(/^User-agent:\s*\*/im);
    expect(robots).not.toMatch(/^\s*Disallow:\s*\S/im);
  });

  it('nothing tracked under app/, public/ or server/ carries a robots-blocking directive', () => {
    const offenders = tracked.filter((f) => /no(index|follow)/i.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no X-Robots-Tag header is configured', () => {
    const offenders = tracked.filter((f) => /x-robots-tag/i.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
