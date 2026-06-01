create table if not exists registrations (
  id bigserial primary key,
  year integer not null check (year between 2000 and 2100),
  month integer not null check (month between 1 and 12),
  state text not null,
  rto text not null,
  fuel_segment text not null,
  fuel_type text not null,
  fuel_filter text not null default 'ALL',
  vehicle_category_filter text not null default 'ALL',
  norms_filter text not null default 'ALL',
  vehicle_class_filter text not null default 'ALL',
  vehicle_count integer not null check (vehicle_count >= 0),
  source_url text not null,
  scraped_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (
    year,
    month,
    state,
    rto,
    fuel_type,
    fuel_filter,
    vehicle_category_filter,
    norms_filter,
    vehicle_class_filter
  )
);

alter table registrations
  add column if not exists fuel_filter text not null default 'ALL',
  add column if not exists vehicle_category_filter text not null default 'ALL',
  add column if not exists norms_filter text not null default 'ALL',
  add column if not exists vehicle_class_filter text not null default 'ALL';

alter table registrations
  drop constraint if exists registrations_year_month_state_rto_fuel_type_key;

create unique index if not exists registrations_context_unique_idx
  on registrations (
    year,
    month,
    state,
    rto,
    fuel_type,
    fuel_filter,
    vehicle_category_filter,
    norms_filter,
    vehicle_class_filter
  );

create index if not exists registrations_filter_idx
  on registrations (state, rto, year, month);

create index if not exists registrations_fuel_idx
  on registrations (fuel_segment, fuel_type);

create index if not exists registrations_context_filter_idx
  on registrations (fuel_filter, vehicle_category_filter, norms_filter, vehicle_class_filter);

create table if not exists tracked_queries (
  id bigserial primary key,
  label text,
  query text not null check (length(trim(query)) > 0),
  active boolean not null default true,
  run_time_local time not null default time '08:00',
  timezone text not null default 'Asia/Calcutta',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tracked_queries_active_idx
  on tracked_queries (active, run_time_local);

create table if not exists tracked_query_runs (
  id bigserial primary key,
  tracked_query_id bigint not null references tracked_queries(id) on delete cascade,
  observation_date date not null,
  status text not null check (status in ('running', 'success', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists tracked_query_runs_query_date_idx
  on tracked_query_runs (tracked_query_id, observation_date desc, started_at desc);

create table if not exists tracked_query_observations (
  id bigserial primary key,
  tracked_query_id bigint not null references tracked_queries(id) on delete cascade,
  observation_date date not null,
  total integer not null check (total >= 0),
  daily_delta integer,
  weekly_delta integer,
  filters jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  data_status text,
  warnings jsonb not null default '[]'::jsonb,
  freshness jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tracked_query_id, observation_date)
);

create index if not exists tracked_query_observations_query_date_idx
  on tracked_query_observations (tracked_query_id, observation_date desc);
