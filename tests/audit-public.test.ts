import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';

/**
 * The pre-public audit gate is only worth having if it fails when it should.
 * Each case builds a throwaway repository containing one planted problem and
 * runs the real script against it. Planted strings are assembled at runtime so
 * that this file does not itself contain what the audit looks for.
 */
const SCRIPT = resolve('scripts/audit-public.mjs');
const OK_EMAIL = '25056943+someone@users.noreply.github.com';
const dirs: string[] = [];

function repo(files: Record<string, string>, opts: {email?: string; message?: string} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'audit-'));
  dirs.push(dir);
  const git = (...a: string[]) => execFileSync('git', a, {cwd: dir, stdio: 'pipe'});
  git('init', '-q');
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), {recursive: true});
    writeFileSync(join(dir, name), body);
  }
  git('add', '-A');
  git('-c', 'user.name=T', '-c', `user.email=${opts.email ?? OK_EMAIL}`, 'commit', '-q', '-m', opts.message ?? 'chore: init');
  return dir;
}

function audit(cwd: string) {
  const r = spawnSync('node', [SCRIPT], {cwd, encoding: 'utf8'});
  return {code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '')};
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

describe('audit-public', () => {
  it('passes a clean repository', () => {
    expect(audit(repo({'a.txt': 'hello'})).code).toBe(0);
  });

  it('fails on a Windows user path in a file', () => {
    const planted = ['C:', 'Users', 'someone', 'work'].join(String.fromCharCode(92));
    const r = audit(repo({'notes.md': `see ${planted}`}));
    expect(r.code).toBe(1);
    expect(r.out).toContain('local path');
  });

  it('fails on a stray email address', () => {
    const r = audit(repo({'notes.md': 'mail me at ' + 'someone' + '@' + 'example.com'}));
    expect(r.code).toBe(1);
    expect(r.out).toContain('email');
  });

  it('fails on a credential shape', () => {
    const r = audit(repo({'cfg.txt': 'token=' + 'shp' + 'at_' + 'a'.repeat(32)}));
    expect(r.code).toBe(1);
    expect(r.out).toContain('credential');
  });

  it('fails on a tracked .env file', () => {
    const r = audit(repo({'.env': 'X=1'}));
    expect(r.code).toBe(1);
    expect(r.out).toContain('tracked env file');
  });

  it('allows .env.example', () => {
    expect(audit(repo({'.env.example': 'X='})).code).toBe(0);
  });

  it('fails on a robots-blocking meta tag', () => {
    const r = audit(repo({'page.html': '<meta name="robots" content="' + 'no' + 'index">'}));
    expect(r.code).toBe(1);
    expect(r.out).toContain('indexing');
  });

  it('fails on a commit author with a personal email', () => {
    const r = audit(repo({'a.txt': 'x'}, {email: 'someone' + '@' + 'example.com'}));
    expect(r.code).toBe(1);
    expect(r.out).toContain('identity email');
  });

  it('fails on a local path in a commit message', () => {
    const planted = '/' + 'home' + '/someone/project/';
    const r = audit(repo({'a.txt': 'x'}, {message: `fix: ran from ${planted}`}));
    expect(r.code).toBe(1);
    expect(r.out).toContain('commit');
  });

  it('checks extra terms from the environment', () => {
    const dir = repo({'a.txt': 'the word zorkmid appears'});
    const r = spawnSync('node', [SCRIPT], {cwd: dir, encoding: 'utf8', env: {...process.env, AUDIT_EXTRA_TERMS: 'zorkmid'}});
    expect(r.status).toBe(1);
  });
});
