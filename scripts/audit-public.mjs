import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

/**
 * Pre-public audit gate. Fails when the tracked tree or the commit history
 * contains something that must not ship in a public repository:
 *
 *   - local filesystem paths (Windows drive paths, /Users/..., /home/...)
 *   - email addresses other than GitHub and Anthropic noreply addresses
 *   - credential shapes (provider tokens, private keys, database URLs with a password)
 *   - tracked .env files
 *   - noindex / nofollow anywhere in the site
 *
 * It scans every tracked file, and every commit message, author and committer
 * on the checked-out history. CI checks out the full history for this reason.
 *
 * Words that identify people, clients or internal tooling cannot be listed
 * here, because listing them would publish them. Set AUDIT_EXTRA_TERMS to a
 * comma-separated list to have them checked locally:
 *
 *   AUDIT_EXTRA_TERMS="word one,word two" npm run audit:public
 */
const SELF = 'scripts/audit-public.mjs';
const SKIP_FILES = [SELF, 'package-lock.json', 'extensions/map-guard/package-lock.json', 'extensions/map-guard-settings/package-lock.json'];
const BINARY = /\.(png|jpe?g|webp|avif|gif|ico|woff2?|ttf|otf|pdf)$/i;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const EMAIL_OK = /^(?:[0-9]+\+[A-Za-z0-9-]+@users\.noreply\.github\.com|noreply@github\.com|noreply@anthropic\.com)$/i;

const RULES = [
  ['local path', /[A-Za-z]:[\\/]+Users[\\/]/],
  ['local path', /(?:^|[\s"'`(=])\/(?:Users|home)\/[A-Za-z0-9._-]+\//],
  ['local path', /AppData[\\/]/],
  ['credential', /\bshp(?:at|ss|ca|ua)_[A-Za-z0-9]{16,}/],
  ['credential', /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ['credential', /\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ['credential', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['credential', /\bAKIA[0-9A-Z]{16}\b/],
  ['credential', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['credential', /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/],
  ['indexing', /\bno(?:index|follow)\b/i],
];

const extra = (process.env.AUDIT_EXTRA_TERMS ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)
  .map((t) => ['extra term', new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')]);

const git = (...args) => execFileSync('git', args, {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});

const hits = [];
const scan = (where, text) => {
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const [label, re] of [...RULES, ...extra]) {
      if (re.test(line)) hits.push(`${where}:${i + 1}  ${label}: ${line.trim().slice(0, 100)}`);
    }
    for (const m of line.match(EMAIL) ?? []) {
      if (!EMAIL_OK.test(m)) hits.push(`${where}:${i + 1}  email: ${m}`);
    }
  });
};

for (const file of git('ls-files', '-z').split('\0').filter(Boolean)) {
  if (/(^|\/)\.env(\.|$)/.test(file) && !file.endsWith('.env.example')) {
    hits.push(`${file}  tracked env file`);
    continue;
  }
  if (SKIP_FILES.includes(file) || BINARY.test(file)) continue;
  scan(file, readFileSync(file, 'utf8'));
}

const SEP = '\x1e';
const log = git('log', '--format=%H%x1f%an <%ae>%x1f%cn <%ce>%x1f%B%x1e').split(SEP).filter((c) => c.trim());
for (const entry of log) {
  const [sha, author, committer, body = ''] = entry.trim().split('\x1f');
  const short = sha.slice(0, 7);
  for (const who of [author, committer]) {
    const email = who.match(/<(.*)>/)?.[1] ?? '';
    if (!EMAIL_OK.test(email)) hits.push(`commit ${short}  identity email: ${email}`);
  }
  scan(`commit ${short} message`, body);
}

if (hits.length) {
  console.error(`Pre-public audit failed: ${hits.length} finding(s)\n`);
  for (const h of hits) console.error('  ' + h);
  process.exit(1);
}
console.log(`Pre-public audit clean: ${git('ls-files').split('\n').filter(Boolean).length} tracked files, ${log.length} commits.`);
