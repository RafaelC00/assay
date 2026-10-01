import {data, useLoaderData} from 'react-router';
import {formatValue, type Cell} from '~/lib/vitals/aggregate';
import {readStatus, type StatusData} from '~/lib/vitals/db.server';
import {METRICS, MIN_SAMPLES, THRESHOLDS, type MetricName} from '~/lib/vitals/schema';

export const meta = () => [
  {title: 'Status | ASSAY'},
  {
    name: 'description',
    content:
      'Core Web Vitals measured from real visits to this storefront: 75th percentile LCP, INP and CLS by page and device, with sample counts.',
  },
];

const CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';

export async function loader() {
  try {
    const status = await readStatus();
    return data({kind: 'ok' as const, status}, {headers: {'Cache-Control': CACHE}});
  } catch (err) {
    console.error('status read failed', err instanceof Error ? err.message : 'unknown error');
    // Never cached: a failed read must not linger as the page.
    return data({kind: 'unavailable' as const}, {status: 503, headers: {'Cache-Control': 'no-store'}});
  }
}

export function headers({loaderHeaders}: {loaderHeaders: Headers}) {
  return loaderHeaders;
}

const utc = (iso: string) => iso.replace('T', ' ').slice(0, 16) + ' UTC';

const LABELS: Record<MetricName, string> = {
  LCP: 'LCP (loading)',
  INP: 'INP (responsiveness)',
  CLS: 'CLS (visual stability)',
};

function CellView({metric, cell}: {metric: MetricName; cell: Cell}) {
  if (cell.state === 'none') return <span className="muted">No samples</span>;
  if (cell.state === 'too-few') {
    return (
      <span className="muted">
        Too few samples to judge
        <br />
        <small>
          {cell.count} of {cell.needed} needed
        </small>
      </span>
    );
  }
  return (
    <span>
      <strong className={`rating rating--${cell.rating}`}>{formatValue(metric, cell.p75)}</strong>
      <br />
      <small className="muted">
        {cell.rating.replace('-', ' ')} · {cell.count.toLocaleString('en-US')} samples
      </small>
    </span>
  );
}

function Results({status}: {status: StatusData}) {
  return (
    <>
      <p className="muted">
        Window: the last {status.windowDays} days, {utc(status.windowStart)} to {utc(status.generatedAt)}. Page
        generated {utc(status.generatedAt)} (refreshed at most once a minute).{' '}
        {status.newestSampleAt ? <>Newest sample: {utc(status.newestSampleAt)}.</> : null}
      </p>

      {status.totalSamples === 0 ? (
        <div className="notice">
          <h2>No data yet</h2>
          <p>
            No visit has reported a measurement in the last {status.windowDays} days, so there is nothing to
            show. This is not a passing grade: it means nobody has been measured. Numbers appear here as
            people use the site.
          </p>
        </div>
      ) : (
        <>
          <p>
            {status.totalSamples.toLocaleString('en-US')} samples in the window. A figure is only shown once a
            page and device group has at least {MIN_SAMPLES} samples for that metric; below that it would be
            noise.
          </p>
          <div className="table-scroll">
            <table className="vitals">
              <caption className="sr-only">75th percentile Core Web Vitals by page and device</caption>
              <thead>
                <tr>
                  <th scope="col">Page</th>
                  <th scope="col">Device</th>
                  {METRICS.map((m) => (
                    <th scope="col" key={m}>
                      {LABELS[m]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {status.table.map((row) => (
                  <tr key={`${row.route}|${row.device}`}>
                    <th scope="row">
                      <code>{row.route}</code>
                    </th>
                    <td>{row.device}</td>
                    {METRICS.map((m) => (
                      <td key={m}>
                        <CellView metric={m} cell={row.cells[m]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

export default function Status() {
  const result = useLoaderData<typeof loader>();

  return (
    <article>
      <h1>Status</h1>
      <p className="lead">
        How this storefront performs for real visitors, measured in their browsers and updated continuously.
      </p>

      {result.kind === 'ok' ? (
        <Results status={result.status} />
      ) : (
        <div className="notice">
          <h2>Measurements are unavailable</h2>
          <p>
            The metrics store could not be read just now. That says nothing about the site&apos;s speed either
            way. Try again in a minute.
          </p>
        </div>
      )}

      <h2>What the numbers mean</h2>
      <p>
        Each figure is the <strong>75th percentile (p75)</strong>: three quarters of visits were at least this
        good. Google&apos;s Core Web Vitals assessment uses p75 rather than the average, because the average
        hides the slow tail and a few extreme visits drag it around. The ratings use the published thresholds:
      </p>
      <ul>
        {METRICS.map((m) => {
          const [good, poor] = THRESHOLDS[m];
          return (
            <li key={m}>
              <strong>{m}</strong>: good up to {formatValue(m, good)}, poor beyond {formatValue(m, poor)}.
            </li>
          );
        })}
      </ul>

      <h2>What is collected, and what is not</h2>
      <p>
        When a page is closed or hidden, the visitor&apos;s browser sends one small message containing only:
      </p>
      <ul>
        <li>the metric name (LCP, INP or CLS) and its value,</li>
        <li>
          the page type, such as <code>/products/:handle</code>, never the actual address and never a query
          string,
        </li>
        <li>a coarse device class, mobile or desktop, and</li>
        <li>the time it was received.</li>
      </ul>
      <p>
        <strong>Not collected:</strong> IP addresses, user-agent strings, cookies, session or visitor
        identifiers, anything stored in the browser, referrers, or any free text. Nothing in the data can be used
        to recognise a person or to link two visits. To limit abuse of the endpoint, the server briefly counts
        requests per sender using a keyed hash held only in memory for about a minute; it is never written to the
        database. Samples are deleted after 30 days. The code that does all of this is in the open repository.
      </p>
    </article>
  );
}
