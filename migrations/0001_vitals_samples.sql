-- One row per measurement reported by a real visitor's browser.
--
-- Privacy: this table is the whole of what is stored. There is deliberately no
-- column for an IP address, a user-agent string, a session or visitor id, a
-- full URL or a query string, so none of them can be written even by mistake.
-- `route` holds a route pattern such as /products/:handle, never a resolved URL.

create table vitals_samples (
  id          bigint generated always as identity primary key,
  metric      text             not null check (metric in ('LCP', 'INP', 'CLS')),
  value       double precision not null check (value >= 0),
  route       text             not null check (char_length(route) <= 40),
  device      text             not null check (device in ('mobile', 'desktop')),
  recorded_at timestamptz      not null default now()
);

-- The status page reads one window of recent rows, grouped by
-- (route, device, metric). This index serves that grouping and the window
-- filter.
create index vitals_samples_group_idx
  on vitals_samples (route, device, metric, recorded_at desc);

-- Retention pruning and "newest sample" lookups filter on time alone.
create index vitals_samples_recorded_at_idx
  on vitals_samples (recorded_at desc);
