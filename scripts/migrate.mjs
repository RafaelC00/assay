import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import pg from 'pg';

/**
 * Applies migrations/*.sql in filename order, once each.
 *
 * Plain SQL and a bookkeeping table: the project has no ORM and this does not
 * need one. Each file runs inside a transaction together with its bookkeeping
 * row, so a failed migration leaves nothing half-applied.
 *
 * Usage: DATABASE_URL_UNPOOLED=... node scripts/migrate.mjs
 * (DATABASE_URL is used as a fallback.) Migrations should run over the
 * unpooled connection, since pooled connections may not support every DDL.
 */
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL_UNPOOLED (or DATABASE_URL) to run migrations.');
  process.exit(1);
}

const client = new pg.Client({connectionString: url, ssl: {rejectUnauthorized: true}});
await client.connect();

try {
  await client.query(
    `create table if not exists schema_migrations (
       name text primary key,
       applied_at timestamptz not null default now()
     )`,
  );
  const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
  const files = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (done.has(file)) {
      console.log(`skip     ${file}`);
      continue;
    }
    await client.query('begin');
    try {
      await client.query(readFileSync(join('migrations', file), 'utf8'));
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
      console.log(`applied  ${file}`);
    } catch (err) {
      await client.query('rollback');
      throw err;
    }
  }
} finally {
  await client.end();
}
