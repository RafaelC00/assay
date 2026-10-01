import {neon} from '@neondatabase/serverless';
import {buildTable, type GroupRow, type TableRow} from './aggregate';
import {RETENTION_DAYS, WINDOW_DAYS, type DeviceClass, type MetricName, type RoutePattern} from './schema';
import type {Sample} from './validate';

/**
 * The only module that talks to the database. SQL is plain and parameterised;
 * there is no ORM.
 */

/** Most recent raw values read per (route, device, metric) group. */
const MAX_VALUES_PER_GROUP = 2000;

function client() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return neon(url);
}

export async function insertSamples(samples: readonly Sample[]): Promise<void> {
  const sql = client();
  await sql.query(
    `insert into vitals_samples (metric, value, route, device)
     select * from unnest($1::text[], $2::float8[], $3::text[], $4::text[])`,
    [
      samples.map((s) => s.metric),
      samples.map((s) => s.value),
      samples.map((s) => s.route),
      samples.map((s) => s.device),
    ],
  );
}

/** Deletes samples past retention. Cheap, and called opportunistically. */
export async function pruneOld(): Promise<void> {
  await client().query(`delete from vitals_samples where recorded_at < now() - make_interval(days => $1)`, [
    RETENTION_DAYS,
  ]);
}

export type StatusData = {
  generatedAt: string;
  windowDays: number;
  windowStart: string;
  totalSamples: number;
  newestSampleAt: string | null;
  table: TableRow[];
};

export async function readStatus(): Promise<StatusData> {
  const sql = client();

  const [groups, totals] = await Promise.all([
    sql.query(
      `with ranked as (
         select route, device, metric, value,
                row_number() over (partition by route, device, metric order by recorded_at desc) as rn,
                count(*)     over (partition by route, device, metric) as n
         from vitals_samples
         where recorded_at >= now() - make_interval(days => $1)
       )
       select route, device, metric, max(n)::int as n, array_agg(value) as vals
       from ranked
       where rn <= $2
       group by route, device, metric`,
      [WINDOW_DAYS, MAX_VALUES_PER_GROUP],
    ),
    sql.query(
      `select count(*)::int as total, max(recorded_at) as newest, now() as now
       from vitals_samples
       where recorded_at >= now() - make_interval(days => $1)`,
      [WINDOW_DAYS],
    ),
  ]);

  const rows: GroupRow[] = (groups as Record<string, unknown>[]).map((r) => ({
    route: r.route as RoutePattern,
    device: r.device as DeviceClass,
    metric: r.metric as MetricName,
    count: r.n as number,
    values: (r.vals as (number | string)[]).map(Number),
  }));

  const t = (totals as Record<string, unknown>[])[0];
  const now = new Date(t.now as string | Date);
  const newest = t.newest ? new Date(t.newest as string | Date).toISOString() : null;

  return {
    generatedAt: now.toISOString(),
    windowDays: WINDOW_DAYS,
    windowStart: new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString(),
    totalSamples: t.total as number,
    newestSampleAt: newest,
    table: buildTable(rows),
  };
}
