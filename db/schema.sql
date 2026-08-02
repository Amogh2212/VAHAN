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

create table if not exists maker_registrations (
  id bigserial primary key,
  year integer not null check (year between 2000 and 2100),
  month integer not null check (month between 1 and 12),
  state text not null,
  rto text not null,
  maker text not null,
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
    maker,
    fuel_filter,
    vehicle_category_filter,
    norms_filter,
    vehicle_class_filter
  )
);

create index if not exists maker_registrations_filter_idx
  on maker_registrations (state, rto, year, month);

create index if not exists maker_registrations_maker_idx
  on maker_registrations (maker);

create index if not exists maker_registrations_context_filter_idx
  on maker_registrations (fuel_filter, vehicle_category_filter, norms_filter, vehicle_class_filter);

create table if not exists users (
  id bigserial primary key,
  google_sub text not null unique,
  email text not null,
  name text,
  picture_url text,
  telegram_chat_id text unique,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table users
  add column if not exists role text not null default 'user';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_role_check'
      and conrelid = 'users'::regclass
  ) then
    alter table users
      add constraint users_role_check check (role in ('user', 'admin'));
  end if;
end
$$;

create index if not exists users_email_idx
  on users (email);

create table if not exists sessions (
  id text primary key,
  user_id bigint not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_idx
  on sessions (user_id);

create index if not exists sessions_expires_idx
  on sessions (expires_at);

create table if not exists request_rate_limits (
  bucket_key text primary key,
  request_count integer not null check (request_count > 0),
  reset_at timestamptz not null
);

create index if not exists request_rate_limits_reset_idx
  on request_rate_limits (reset_at);

create table if not exists telegram_link_codes (
  code text primary key,
  user_id bigint not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists telegram_link_codes_user_idx
  on telegram_link_codes (user_id);

create table if not exists tracked_queries (
  id bigserial primary key,
  user_id bigint references users(id) on delete cascade,
  label text,
  query text not null check (length(trim(query)) > 0),
  active boolean not null default true,
  run_time_local time not null default time '08:00',
  timezone text not null default 'Asia/Calcutta',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table tracked_queries
  add column if not exists user_id bigint references users(id) on delete cascade;

create index if not exists tracked_queries_active_idx
  on tracked_queries (active, run_time_local);

create index if not exists tracked_queries_user_idx
  on tracked_queries (user_id, active, id);

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

create table if not exists rto_daily_snapshot_configs (
  id bigserial primary key,
  state text not null,
  rto text not null,
  enabled boolean not null default true,
  priority integer not null default 100,
  last_snapshot_date date,
  last_status text,
  last_error text,
  catalog_last_seen_at timestamptz,
  catalog_miss_count integer not null default 0 check (catalog_miss_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (state, rto)
);

alter table rto_daily_snapshot_configs
  add column if not exists catalog_last_seen_at timestamptz;

alter table rto_daily_snapshot_configs
  add column if not exists catalog_miss_count integer not null default 0;

create index if not exists rto_daily_snapshot_configs_queue_idx
  on rto_daily_snapshot_configs (enabled, priority, last_snapshot_date, state, rto);

create table if not exists rto_daily_pins (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  config_id bigint not null references rto_daily_snapshot_configs(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, config_id)
);

create index if not exists rto_daily_pins_user_idx
  on rto_daily_pins (user_id, created_at desc);

create index if not exists rto_daily_pins_config_idx
  on rto_daily_pins (config_id);

create table if not exists rto_daily_collection_runs (
  id bigserial primary key,
  status text not null check (status in ('running', 'success', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  attempted_rtos integer not null default 0,
  succeeded_rtos integer not null default 0,
  failed_rtos integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);

alter table rto_daily_collection_runs
  add column if not exists snapshot_date date;

alter table rto_daily_collection_runs
  add column if not exists target_month text;

alter table rto_daily_collection_runs
  add column if not exists worker_count integer not null default 1;

alter table rto_daily_collection_runs
  add column if not exists total_rtos integer not null default 0;

alter table rto_daily_collection_runs
  add column if not exists report_cohort_hash text;

alter table rto_daily_collection_runs
  add column if not exists report_cohort_size integer not null default 0;

create unique index if not exists rto_daily_collection_runs_cycle_idx
  on rto_daily_collection_runs (snapshot_date, target_month)
  where snapshot_date is not null and target_month is not null;

create index if not exists rto_daily_collection_runs_started_idx
  on rto_daily_collection_runs (started_at desc);

create table if not exists rto_daily_jobs (
  id bigserial primary key,
  run_id bigint not null references rto_daily_collection_runs(id) on delete cascade,
  config_id bigint not null references rto_daily_snapshot_configs(id) on delete cascade,
  snapshot_date date not null,
  target_month text not null check (target_month ~ '^[0-9]{4}-[0-9]{2}$'),
  state text not null,
  rto text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'retrying', 'success', 'failed', 'deferred')),
  queue_priority integer not null default 100 check (queue_priority >= 0),
  queue_reason text not null default 'rotation' check (queue_reason in ('pin', 'lookup', 'rotation')),
  attempts integer not null default 0 check (attempts >= 0),
  worker_id text,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, config_id)
);

alter table rto_daily_jobs
  add column if not exists queue_priority integer not null default 100;

alter table rto_daily_jobs
  add column if not exists queue_reason text not null default 'rotation';

alter table rto_daily_jobs
  drop constraint if exists rto_daily_jobs_status_check;

alter table rto_daily_jobs
  add constraint rto_daily_jobs_status_check
  check (status in ('queued', 'running', 'retrying', 'success', 'failed', 'deferred'));

alter table rto_daily_jobs
  drop constraint if exists rto_daily_jobs_queue_priority_check;

alter table rto_daily_jobs
  add constraint rto_daily_jobs_queue_priority_check
  check (queue_priority >= 0);

alter table rto_daily_jobs
  drop constraint if exists rto_daily_jobs_queue_reason_check;

alter table rto_daily_jobs
  add constraint rto_daily_jobs_queue_reason_check
  check (queue_reason in ('pin', 'lookup', 'rotation'));

create index if not exists rto_daily_jobs_priority_claim_idx
  on rto_daily_jobs (run_id, status, queue_priority, next_attempt_at, lease_expires_at, id);

create index if not exists rto_daily_jobs_rto_date_idx
  on rto_daily_jobs (state, rto, snapshot_date desc);

create table if not exists rto_daily_scrape_reports (
  id bigserial primary key,
  run_id bigint not null references rto_daily_collection_runs(id) on delete cascade,
  job_id bigint not null references rto_daily_jobs(id) on delete cascade,
  snapshot_date date not null,
  target_month text not null check (target_month ~ '^[0-9]{4}-[0-9]{2}$'),
  state text not null,
  rto text not null,
  fuel_group text not null check (fuel_group in ('EV', 'ICE')),
  vehicle_category text not null check (vehicle_category in ('2W', '3W', '4W')),
  status text not null check (status in ('success', 'failed')),
  report_total integer check (report_total >= 0),
  source_row_count integer not null default 0 check (source_row_count >= 0),
  attempts integer not null default 1 check (attempts >= 1),
  filters_confirmed boolean not null default false,
  explicit_zero boolean not null default false,
  scraped_at timestamptz not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (snapshot_date, target_month, state, rto, fuel_group, vehicle_category)
);

create index if not exists rto_daily_scrape_reports_job_idx
  on rto_daily_scrape_reports (job_id, fuel_group, vehicle_category);

create index if not exists rto_daily_scrape_reports_run_idx
  on rto_daily_scrape_reports (run_id);

create table if not exists rto_daily_snapshots (
  id bigserial primary key,
  snapshot_date date not null,
  target_month text not null check (target_month ~ '^[0-9]{4}-[0-9]{2}$'),
  state text not null,
  rto text not null,
  fuel_group text not null check (fuel_group in ('EV', 'ICE')),
  vehicle_category text not null check (vehicle_category in ('2W', '3W', '4W')),
  oem text not null,
  vehicle_count integer not null check (vehicle_count >= 0),
  source text not null default 'vahan-scraper',
  scrape_status text not null default 'success',
  scrape_run_id bigint references rto_daily_collection_runs(id) on delete set null,
  report_id bigint references rto_daily_scrape_reports(id) on delete set null,
  scraped_at timestamptz not null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (snapshot_date, target_month, state, rto, fuel_group, vehicle_category, oem)
);

alter table rto_daily_snapshots
  add column if not exists report_id bigint references rto_daily_scrape_reports(id) on delete set null;

create index if not exists rto_daily_snapshots_lookup_idx
  on rto_daily_snapshots (state, rto, fuel_group, vehicle_category, oem, snapshot_date desc);

create index if not exists rto_daily_snapshots_retention_idx
  on rto_daily_snapshots (snapshot_date);

create index if not exists rto_daily_snapshots_run_idx
  on rto_daily_snapshots (scrape_run_id);

create index if not exists rto_daily_snapshots_report_idx
  on rto_daily_snapshots (report_id);

create table if not exists rto_monthly_snapshot_aggregates (
  id bigserial primary key,
  target_month text not null check (target_month ~ '^[0-9]{4}-[0-9]{2}$'),
  state text not null,
  rto text not null,
  fuel_group text not null check (fuel_group in ('EV', 'ICE')),
  vehicle_category text not null check (vehicle_category in ('2W', '3W', '4W')),
  oem text not null,
  latest_snapshot_date date not null,
  latest_vehicle_count integer not null check (latest_vehicle_count >= 0),
  min_vehicle_count integer not null check (min_vehicle_count >= 0),
  max_vehicle_count integer not null check (max_vehicle_count >= 0),
  sample_count integer not null check (sample_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (target_month, state, rto, fuel_group, vehicle_category, oem)
);

create index if not exists rto_monthly_snapshot_aggregates_lookup_idx
  on rto_monthly_snapshot_aggregates (state, rto, fuel_group, vehicle_category, oem, target_month desc);

create table if not exists rto_daily_run_cohort_members (
  run_id bigint not null references rto_daily_collection_runs(id) on delete cascade,
  config_id bigint references rto_daily_snapshot_configs(id) on delete set null,
  snapshot_date date not null,
  target_month text not null check (target_month ~ '^[0-9]{4}-[0-9]{2}$'),
  state text not null,
  rto text not null,
  cohort_rank integer not null check (cohort_rank >= 1),
  created_at timestamptz not null default now(),
  primary key (run_id, state, rto),
  unique (run_id, cohort_rank)
);

create index if not exists rto_daily_run_cohort_members_lookup_idx
  on rto_daily_run_cohort_members (state, rto, snapshot_date desc);

create table if not exists rto_daily_report_totals (
  id bigserial primary key,
  snapshot_date date not null,
  target_month text not null check (target_month ~ '^[0-9]{4}-[0-9]{2}$'),
  state text not null,
  rto text not null,
  fuel_group text not null check (fuel_group in ('EV', 'ICE')),
  vehicle_category text not null check (vehicle_category in ('2W', '3W', '4W')),
  report_total integer not null check (report_total >= 0),
  tracked_oem_total integer not null default 0 check (tracked_oem_total >= 0),
  untracked_total integer check (untracked_total >= 0),
  source_run_id bigint references rto_daily_collection_runs(id) on delete set null,
  source_report_id bigint references rto_daily_scrape_reports(id) on delete set null,
  filters_confirmed boolean not null default false,
  explicit_zero boolean not null default false,
  scrape_status text not null default 'success' check (scrape_status in ('success', 'late_fill')),
  quality_status text not null default 'ready' check (quality_status in ('ready', 'needs_review')),
  quality_flags jsonb not null default '{}'::jsonb,
  scraped_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (snapshot_date, target_month, state, rto, fuel_group, vehicle_category)
);

create index if not exists rto_daily_report_totals_lookup_idx
  on rto_daily_report_totals (state, rto, snapshot_date desc, fuel_group, vehicle_category);

create index if not exists rto_daily_report_totals_retention_idx
  on rto_daily_report_totals (snapshot_date);

create index if not exists rto_daily_report_totals_source_run_idx
  on rto_daily_report_totals (source_run_id);

create index if not exists rto_daily_report_totals_source_report_idx
  on rto_daily_report_totals (source_report_id);

create table if not exists rto_daily_oem_totals (
  id bigserial primary key,
  snapshot_date date not null,
  target_month text not null check (target_month ~ '^[0-9]{4}-[0-9]{2}$'),
  state text not null,
  rto text not null,
  fuel_group text not null check (fuel_group in ('EV', 'ICE')),
  vehicle_category text not null check (vehicle_category in ('2W', '3W', '4W')),
  oem text not null,
  vehicle_count integer not null check (vehicle_count >= 0),
  source_run_id bigint references rto_daily_collection_runs(id) on delete set null,
  scrape_status text not null default 'success' check (scrape_status in ('success', 'late_fill')),
  scraped_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (snapshot_date, target_month, state, rto, fuel_group, vehicle_category, oem)
);

create index if not exists rto_daily_oem_totals_lookup_idx
  on rto_daily_oem_totals (state, rto, oem, snapshot_date desc, fuel_group, vehicle_category);

create index if not exists rto_daily_oem_totals_retention_idx
  on rto_daily_oem_totals (snapshot_date);

create index if not exists rto_daily_oem_totals_source_run_idx
  on rto_daily_oem_totals (source_run_id);

create table if not exists rto_report_batches (
  id bigserial primary key,
  cadence text not null check (cadence in ('daily', 'weekly', 'monthly')),
  period_start date not null,
  period_end date not null,
  source_snapshot_date date not null,
  source_run_id bigint references rto_daily_collection_runs(id) on delete set null,
  cohort_hash text not null,
  cohort_size integer not null default 100 check (cohort_size >= 1),
  status text not null default 'queued'
    check (status in ('queued', 'generating', 'ready', 'ready_with_warnings', 'needs_review', 'failed')),
  revision integer not null default 1 check (revision >= 1),
  coverage_count integer not null default 0 check (coverage_count >= 0),
  report_count integer not null default 0 check (report_count >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  late_fill boolean not null default false,
  source_checksum text,
  quality_summary jsonb not null default '{}'::jsonb,
  last_error text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cadence, period_start, period_end, cohort_hash)
);

create index if not exists rto_report_batches_period_idx
  on rto_report_batches (cadence, period_end desc, status);

create index if not exists rto_report_batches_source_run_idx
  on rto_report_batches (source_run_id);

create table if not exists rto_reports (
  id bigserial primary key,
  batch_id bigint not null references rto_report_batches(id) on delete cascade,
  state text not null,
  rto text not null,
  selection_rank integer not null check (selection_rank >= 1),
  cohort_rank integer,
  previous_rank integer,
  status text not null check (status in ('ready', 'ready_with_warnings', 'needs_review', 'failed')),
  period_ev integer,
  period_ice integer,
  mtd_ev integer,
  mtd_ice integer,
  ev_share numeric(7,4),
  summary text not null,
  payload jsonb not null,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, state, rto)
);

create index if not exists rto_reports_batch_rank_idx
  on rto_reports (batch_id, cohort_rank nulls last, selection_rank);

create index if not exists rto_reports_lookup_idx
  on rto_reports (state, rto, generated_at desc);

create table if not exists rto_report_exports (
  id bigserial primary key,
  scope_type text not null check (scope_type in ('report', 'batch')),
  scope_id bigint not null,
  format text not null check (format in ('pdf', 'csv')),
  revision integer not null check (revision >= 1),
  storage_path text not null,
  checksum text not null,
  byte_size bigint not null check (byte_size >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope_type, scope_id, format, revision)
);

create index if not exists rto_report_exports_expiry_idx
  on rto_report_exports (expires_at);

create table if not exists rto_geo_profiles (
  id bigserial primary key,
  state text not null,
  rto text not null,
  rto_code text,
  place_label text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  confidence_score numeric(5,4) not null default 0 check (confidence_score >= 0 and confidence_score <= 1),
  source text not null default 'manual',
  source_url text,
  reviewed boolean not null default false,
  raw jsonb not null default '{}'::jsonb,
  geocoded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (state, rto)
);

create index if not exists rto_geo_profiles_location_idx
  on rto_geo_profiles (state, rto, confidence_score desc);

create table if not exists rto_external_signals (
  id bigserial primary key,
  state text not null,
  rto text not null,
  signal_key text not null,
  signal_group text not null,
  provider text not null,
  radius_km integer not null default 0 check (radius_km >= 0),
  period_start date,
  period_end date,
  numeric_value double precision not null default 0 check (numeric_value >= 0),
  unit text not null default 'count',
  source_url text,
  source_updated_at timestamptz,
  confidence_score numeric(5,4) not null default 0 check (confidence_score >= 0 and confidence_score <= 1),
  evidence jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists rto_external_signals_unique_idx
  on rto_external_signals (
    state,
    rto,
    provider,
    signal_key,
    radius_km,
    coalesce(period_start, date '1900-01-01'),
    coalesce(period_end, date '1900-01-01')
  );

create index if not exists rto_external_signals_lookup_idx
  on rto_external_signals (state, rto, signal_key, radius_km, period_end desc nulls last);

create index if not exists rto_external_signals_group_idx
  on rto_external_signals (signal_group, signal_key, radius_km, fetched_at desc);

create table if not exists rto_pattern_findings (
  id bigserial primary key,
  state text not null,
  rto text not null,
  pattern_key text not null,
  title text not null,
  score numeric(6,2) not null default 0 check (score >= 0),
  confidence_score numeric(5,4) not null default 0 check (confidence_score >= 0 and confidence_score <= 1),
  severity text not null default 'watch' check (severity in ('watch', 'interesting', 'strong')),
  summary text not null,
  evidence jsonb not null default '{}'::jsonb,
  period_start date,
  period_end date,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists rto_pattern_findings_unique_idx
  on rto_pattern_findings (
    state,
    rto,
    pattern_key,
    coalesce(period_end, date '1900-01-01')
  );

create index if not exists rto_pattern_findings_rank_idx
  on rto_pattern_findings (score desc, confidence_score desc, generated_at desc);

create index if not exists rto_pattern_findings_rto_idx
  on rto_pattern_findings (state, rto, generated_at desc);

-- Evidence-backed factor-agent records are append-only. Corrections create a
-- superseding record so every report explanation remains reproducible.
create or replace function prevent_rto_factor_record_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only; create a superseding record instead', tg_table_name
    using errcode = '55000';
end
$$;

create table if not exists rto_factor_sources (
  id bigserial primary key,
  source_key text not null unique
    check (
      source_key = lower(source_key)
      and source_key ~ '^[a-z0-9][a-z0-9._-]{2,127}$'
    ),
  publisher text not null check (char_length(btrim(publisher)) between 2 and 300),
  source_tier text not null check (source_tier in ('A', 'B', 'C', 'D')),
  source_type text not null
    check (
      source_type in (
        'government',
        'regulator',
        'weather_authority',
        'transport_authority',
        'stock_exchange',
        'oem',
        'industry_body',
        'media',
        'other'
      )
    ),
  canonical_host text not null
    check (
      canonical_host = lower(canonical_host)
      and canonical_host ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'
    ),
  evidence_policy text not null
    check (evidence_policy in ('report_evidence', 'lead_only', 'prohibited')),
  intake_method text not null default 'manual'
    check (intake_method in ('manual', 'curated_import')),
  notes text,
  idempotency_key text not null unique
    check (char_length(btrim(idempotency_key)) between 8 and 200),
  record_checksum text not null
    check (record_checksum ~ '^[0-9a-f]{64}$'),
  supersedes_source_id bigint references rto_factor_sources(id) on delete restrict,
  created_by_user_id bigint references users(id) on delete restrict,
  created_by_label text not null check (char_length(btrim(created_by_label)) between 1 and 200),
  created_at timestamptz not null default now(),
  check (supersedes_source_id is null or supersedes_source_id <> id),
  check (
    (source_tier in ('A', 'B') and evidence_policy in ('report_evidence', 'lead_only'))
    or (source_tier = 'C' and evidence_policy = 'lead_only')
    or (source_tier = 'D' and evidence_policy = 'prohibited')
  )
);

create index if not exists rto_factor_sources_lookup_idx
  on rto_factor_sources (source_tier, evidence_policy, publisher, created_at desc);

create table if not exists rto_factor_documents (
  id bigserial primary key,
  source_id bigint not null references rto_factor_sources(id) on delete restrict,
  canonical_url text not null
    check (
      char_length(canonical_url) between 10 and 2048
      and canonical_url ~ '^https://'
    ),
  title text not null check (char_length(btrim(title)) between 2 and 500),
  published_at timestamptz not null,
  retrieved_at timestamptz not null default now(),
  evidence_excerpt text not null
    check (char_length(btrim(evidence_excerpt)) between 1 and 4000),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  content_hash_method text not null
    check (content_hash_method in ('full_content_sha256', 'evidence_snapshot_sha256')),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected')),
  review_reason text,
  reviewed_at timestamptz,
  reviewed_by_user_id bigint references users(id) on delete restrict,
  reviewed_by_label text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  idempotency_key text not null unique
    check (char_length(btrim(idempotency_key)) between 8 and 200),
  record_checksum text not null check (record_checksum ~ '^[0-9a-f]{64}$'),
  supersedes_document_id bigint references rto_factor_documents(id) on delete restrict,
  created_by_user_id bigint references users(id) on delete restrict,
  created_by_label text not null check (char_length(btrim(created_by_label)) between 1 and 200),
  created_at timestamptz not null default now(),
  check (supersedes_document_id is null or supersedes_document_id <> id),
  check (
    (
      review_status = 'pending'
      and reviewed_at is null
      and reviewed_by_user_id is null
      and reviewed_by_label is null
      and review_reason is null
    )
    or (
      review_status = 'approved'
      and reviewed_at is not null
      and reviewed_by_label is not null
      and char_length(btrim(reviewed_by_label)) >= 1
      and review_reason is null
    )
    or (
      review_status = 'rejected'
      and reviewed_at is not null
      and reviewed_by_label is not null
      and char_length(btrim(reviewed_by_label)) >= 1
      and review_reason is not null
      and char_length(btrim(review_reason)) >= 1
    )
  )
);

create index if not exists rto_factor_documents_source_idx
  on rto_factor_documents (source_id, review_status, published_at desc);

create index if not exists rto_factor_documents_url_idx
  on rto_factor_documents (canonical_url, retrieved_at desc);

create table if not exists rto_factor_events (
  id bigserial primary key,
  event_type text not null
    check (
      event_type in (
        'policy',
        'tax_or_fee',
        'incentive',
        'oem_launch',
        'oem_price_change',
        'oem_promotion',
        'weather_disruption',
        'transport_restriction',
        'other_official'
      )
    ),
  title text not null check (char_length(btrim(title)) between 2 and 500),
  claim_summary text not null check (char_length(btrim(claim_summary)) between 5 and 4000),
  hypothesis text not null check (char_length(btrim(hypothesis)) between 5 and 4000),
  expected_direction text not null default 'unknown'
    check (expected_direction in ('increase', 'decrease', 'unknown')),
  effective_start date not null,
  effective_end date not null,
  event_timezone text not null default 'Asia/Kolkata'
    check (event_timezone = 'Asia/Kolkata'),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'eligible', 'context_only', 'rejected')),
  source_reliability_score numeric(5,4) not null default 0
    check (source_reliability_score between 0 and 1),
  review_reason text,
  reviewed_at timestamptz,
  reviewed_by_user_id bigint references users(id) on delete restrict,
  reviewed_by_label text,
  intake_method text not null default 'manual'
    check (intake_method in ('manual', 'curated_import')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  idempotency_key text not null unique
    check (char_length(btrim(idempotency_key)) between 8 and 200),
  event_checksum text not null check (event_checksum ~ '^[0-9a-f]{64}$'),
  supersedes_event_id bigint references rto_factor_events(id) on delete restrict,
  created_by_user_id bigint references users(id) on delete restrict,
  created_by_label text not null check (char_length(btrim(created_by_label)) between 1 and 200),
  created_at timestamptz not null default now(),
  check (effective_end >= effective_start),
  check (supersedes_event_id is null or supersedes_event_id <> id),
  check (
    (
      review_status = 'pending'
      and reviewed_at is null
      and reviewed_by_user_id is null
      and reviewed_by_label is null
      and review_reason is null
    )
    or (
      review_status in ('eligible', 'context_only')
      and reviewed_at is not null
      and reviewed_by_label is not null
      and char_length(btrim(reviewed_by_label)) >= 1
      and review_reason is null
    )
    or (
      review_status = 'rejected'
      and reviewed_at is not null
      and reviewed_by_label is not null
      and char_length(btrim(reviewed_by_label)) >= 1
      and review_reason is not null
      and char_length(btrim(review_reason)) >= 1
    )
  )
);

create index if not exists rto_factor_events_window_idx
  on rto_factor_events (effective_start desc, effective_end desc, review_status, event_type);

create table if not exists rto_factor_event_documents (
  event_id bigint not null references rto_factor_events(id) on delete restrict,
  document_id bigint not null references rto_factor_documents(id) on delete restrict,
  evidence_role text not null check (evidence_role in ('primary', 'corroborating', 'confounder')),
  created_at timestamptz not null default now(),
  primary key (event_id, document_id)
);

create index if not exists rto_factor_event_documents_document_idx
  on rto_factor_event_documents (document_id, event_id);

create table if not exists rto_factor_event_targets (
  id bigserial primary key,
  event_id bigint not null references rto_factor_events(id) on delete restrict,
  target_role text not null default 'affected'
    check (target_role in ('affected', 'excluded_control')),
  geography_scope text not null
    check (geography_scope in ('national', 'state', 'rto')),
  state text,
  rto text,
  oem text,
  fuel_group text check (fuel_group in ('EV', 'ICE', 'ALL')),
  vehicle_category text check (vehicle_category in ('2W', '3W', '4W', 'ALL')),
  created_at timestamptz not null default now(),
  check (
    (geography_scope = 'national' and state is null and rto is null)
    or (
      geography_scope = 'state'
      and state is not null
      and char_length(btrim(state)) >= 1
      and rto is null
    )
    or (
      geography_scope = 'rto'
      and state is not null
      and char_length(btrim(state)) >= 1
      and rto is not null
      and char_length(btrim(rto)) >= 1
    )
  )
);

create unique index if not exists rto_factor_event_targets_unique_idx
  on rto_factor_event_targets (
    event_id,
    target_role,
    geography_scope,
    coalesce(state, ''),
    coalesce(rto, ''),
    coalesce(oem, ''),
    coalesce(fuel_group, ''),
    coalesce(vehicle_category, '')
  );

create index if not exists rto_factor_event_targets_lookup_idx
  on rto_factor_event_targets (state, rto, fuel_group, vehicle_category, event_id);

create table if not exists rto_factor_validations (
  id bigserial primary key,
  event_id bigint not null references rto_factor_events(id) on delete restrict,
  report_id bigint not null references rto_reports(id) on delete restrict,
  report_revision integer not null check (report_revision >= 1),
  report_source_checksum text not null
    check (report_source_checksum ~ '^[0-9a-f]{64}$'),
  decision_status text not null
    check (
      decision_status in (
        'too_early',
        'blocked_data',
        'blocked_evidence',
        'confounded',
        'no_effect',
        'mixed_evidence',
        'supported_association'
      )
    ),
  algorithm_key text not null check (char_length(btrim(algorithm_key)) between 2 and 100),
  algorithm_version text not null check (char_length(btrim(algorithm_version)) between 1 and 100),
  pre_window_start date not null,
  pre_window_end date not null,
  post_window_start date not null,
  post_window_end date not null,
  baseline_value numeric check (baseline_value is null or baseline_value >= 0),
  focal_change numeric,
  control_change numeric,
  effect_size numeric,
  effect_unit text
    check (effect_unit in ('registrations_per_day', 'percent', 'percentage_points')),
  confidence_interval_low numeric,
  confidence_interval_high numeric,
  materiality_threshold numeric check (materiality_threshold is null or materiality_threshold >= 0),
  control_count integer not null default 0 check (control_count >= 0),
  observed_date_coverage numeric(5,4) not null default 0
    check (observed_date_coverage between 0 and 1),
  source_reliability_score numeric(5,4) not null default 0
    check (source_reliability_score between 0 and 1),
  hypothesis_confidence_score numeric(5,4) not null default 0
    check (hypothesis_confidence_score between 0 and 1),
  empirical_support_score numeric(5,4) not null default 0
    check (empirical_support_score between 0 and 1),
  quality_gates jsonb not null default '{}'::jsonb
    check (jsonb_typeof(quality_gates) = 'object'),
  evidence_pack jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence_pack) = 'object'),
  limitations jsonb not null default '[]'::jsonb
    check (jsonb_typeof(limitations) = 'array'),
  idempotency_key text not null unique
    check (char_length(btrim(idempotency_key)) between 8 and 200),
  input_checksum text not null check (input_checksum ~ '^[0-9a-f]{64}$'),
  validation_checksum text not null check (validation_checksum ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check (pre_window_start <= pre_window_end),
  check (pre_window_end < post_window_start),
  check (post_window_start <= post_window_end),
  check (
    confidence_interval_low is null
    or confidence_interval_high is null
    or confidence_interval_low <= confidence_interval_high
  ),
  check (
    decision_status <> 'supported_association'
    or (
      control_count >= 5
      and observed_date_coverage >= 0.9
      and baseline_value is not null
      and focal_change is not null
      and control_change is not null
      and effect_size is not null
      and effect_size = focal_change - control_change
      and effect_unit = 'registrations_per_day'
      and materiality_threshold is not null
      and materiality_threshold >= 5
      and materiality_threshold >= baseline_value * 0.1
      and abs(effect_size) >= materiality_threshold
      and confidence_interval_low is not null
      and confidence_interval_high is not null
      and (
        (effect_size > 0 and confidence_interval_low > 0)
        or (effect_size < 0 and confidence_interval_high < 0)
      )
    )
  ),
  unique (id, report_id, report_revision, report_source_checksum)
);

create index if not exists rto_factor_validations_report_idx
  on rto_factor_validations (report_id, report_revision, decision_status, created_at desc);

create index if not exists rto_factor_validations_event_idx
  on rto_factor_validations (event_id, created_at desc);

create table if not exists rto_factor_validation_controls (
  validation_id bigint not null references rto_factor_validations(id) on delete restrict,
  selected_rank integer not null check (selected_rank >= 1),
  state text not null check (char_length(btrim(state)) >= 1),
  rto text not null check (char_length(btrim(rto)) >= 1),
  match_score numeric(5,4) not null check (match_score between 0 and 1),
  pre_baseline numeric,
  pre_trend numeric,
  exposure_status text not null
    check (exposure_status in ('unexposed', 'excluded', 'unknown')),
  exclusion_reason text,
  created_at timestamptz not null default now(),
  primary key (validation_id, state, rto),
  unique (validation_id, selected_rank),
  check (
    (exposure_status = 'unexposed' and exclusion_reason is null)
    or (
      exposure_status in ('excluded', 'unknown')
      and exclusion_reason is not null
      and char_length(btrim(exclusion_reason)) >= 1
    )
  )
);

create table if not exists rto_factor_validation_documents (
  validation_id bigint not null references rto_factor_validations(id) on delete restrict,
  document_id bigint not null references rto_factor_documents(id) on delete restrict,
  evidence_role text not null check (evidence_role in ('primary', 'corroborating', 'confounder')),
  created_at timestamptz not null default now(),
  primary key (validation_id, document_id)
);

create index if not exists rto_factor_validation_documents_document_idx
  on rto_factor_validation_documents (document_id, validation_id);

create table if not exists rto_report_explanations (
  id bigserial primary key,
  validation_id bigint not null,
  report_id bigint not null,
  report_revision integer not null check (report_revision >= 1),
  report_source_checksum text not null
    check (report_source_checksum ~ '^[0-9a-f]{64}$'),
  heading text not null check (char_length(btrim(heading)) between 2 and 300),
  body text not null check (char_length(btrim(body)) between 5 and 4000),
  confidence_label text not null
    check (
      confidence_label in (
        'supported',
        'mixed_evidence',
        'weak',
        'too_early',
        'contradicted_by_data',
        'blocked'
      )
    ),
  limitations jsonb not null default '[]'::jsonb
    check (jsonb_typeof(limitations) = 'array'),
  generation_method text not null
    check (generation_method in ('llm', 'template', 'manual')),
  model_provider text,
  model_name text,
  prompt_version text not null check (char_length(btrim(prompt_version)) between 1 and 100),
  publication_mode text not null default 'draft_only'
    check (publication_mode = 'draft_only'),
  idempotency_key text not null unique
    check (char_length(btrim(idempotency_key)) between 8 and 200),
  input_checksum text not null check (input_checksum ~ '^[0-9a-f]{64}$'),
  output_checksum text not null check (output_checksum ~ '^[0-9a-f]{64}$'),
  explanation_checksum text not null check (explanation_checksum ~ '^[0-9a-f]{64}$'),
  created_by_user_id bigint references users(id) on delete restrict,
  created_by_label text not null check (char_length(btrim(created_by_label)) between 1 and 200),
  created_at timestamptz not null default now(),
  foreign key (validation_id, report_id, report_revision, report_source_checksum)
    references rto_factor_validations (id, report_id, report_revision, report_source_checksum)
    on delete restrict,
  check (
    (
      generation_method = 'llm'
      and model_provider is not null
      and char_length(btrim(model_provider)) >= 1
      and model_name is not null
      and char_length(btrim(model_name)) >= 1
    )
    or (generation_method in ('template', 'manual'))
  )
);

create index if not exists rto_report_explanations_report_idx
  on rto_report_explanations (report_id, report_revision, created_at desc);

create index if not exists rto_report_explanations_validation_idx
  on rto_report_explanations (validation_id, created_at desc);

create table if not exists rto_report_explanation_documents (
  explanation_id bigint not null references rto_report_explanations(id) on delete restrict,
  document_id bigint not null references rto_factor_documents(id) on delete restrict,
  citation_order integer not null check (citation_order >= 1),
  citation_label text not null check (char_length(btrim(citation_label)) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (explanation_id, document_id),
  unique (explanation_id, citation_order)
);

create index if not exists rto_report_explanation_documents_document_idx
  on rto_report_explanation_documents (document_id, explanation_id);

create table if not exists rto_report_explanation_reviews (
  id bigserial primary key,
  explanation_id bigint not null references rto_report_explanations(id) on delete restrict,
  decision text not null
    check (decision in ('approved', 'edited_and_approved', 'rejected', 'needs_more_data', 'revoked')),
  edited_heading text,
  edited_body text,
  reason text,
  idempotency_key text not null unique
    check (char_length(btrim(idempotency_key)) between 8 and 200),
  review_checksum text not null check (review_checksum ~ '^[0-9a-f]{64}$'),
  reviewer_user_id bigint references users(id) on delete restrict,
  reviewer_label text not null check (char_length(btrim(reviewer_label)) between 1 and 200),
  created_at timestamptz not null default now(),
  check (
    (
      decision = 'approved'
      and edited_heading is null
      and edited_body is null
      and reason is null
    )
    or (
      decision = 'edited_and_approved'
      and edited_heading is not null
      and char_length(btrim(edited_heading)) between 2 and 300
      and edited_body is not null
      and char_length(btrim(edited_body)) between 5 and 4000
      and reason is null
    )
    or (
      decision in ('rejected', 'needs_more_data', 'revoked')
      and edited_heading is null
      and edited_body is null
      and reason is not null
      and char_length(btrim(reason)) >= 1
    )
  )
);

create index if not exists rto_report_explanation_reviews_latest_idx
  on rto_report_explanation_reviews (explanation_id, created_at desc, id desc);

create or replace function validate_rto_factor_document_insert()
returns trigger
language plpgsql
as $$
declare
  allowed_host text;
  allowed_policy text;
begin
  select canonical_host, evidence_policy
  into allowed_host, allowed_policy
  from rto_factor_sources
  where id = new.source_id;

  if not found then
    raise exception 'Factor source % was not found', new.source_id
      using errcode = '23503';
  end if;

  if lower(substring(new.canonical_url from '^https://([^/:?#]+)')) is distinct from allowed_host then
    raise exception 'Document host does not match source allowlist host %', allowed_host
      using errcode = '23514';
  end if;

  if new.review_status = 'approved' and allowed_policy <> 'report_evidence' then
    raise exception 'Only report-evidence sources can create approved factor documents'
      using errcode = '23514';
  end if;

  if new.supersedes_document_id is not null and not exists (
    select 1
    from rto_factor_documents prior
    where prior.id = new.supersedes_document_id
      and prior.source_id = new.source_id
  ) then
    raise exception 'A factor document can only supersede a document from the same source'
      using errcode = '23514';
  end if;

  return new;
end
$$;

drop trigger if exists rto_factor_documents_source_guard on rto_factor_documents;
create trigger rto_factor_documents_source_guard
before insert on rto_factor_documents
for each row execute function validate_rto_factor_document_insert();

create or replace function validate_rto_factor_event_evidence()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from rto_factor_event_documents ed
    where ed.event_id = new.id
      and ed.evidence_role = 'primary'
  ) then
    raise exception 'Factor event % requires a primary evidence document', new.id
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from rto_factor_event_targets et
    where et.event_id = new.id
      and et.target_role = 'affected'
  ) then
    raise exception 'Factor event % requires an affected target', new.id
      using errcode = '23514';
  end if;

  if new.review_status in ('eligible', 'context_only') and exists (
    select 1
    from rto_factor_event_documents ed
    join rto_factor_documents d on d.id = ed.document_id
    join rto_factor_sources s on s.id = d.source_id
    where ed.event_id = new.id
      and ed.evidence_role <> 'confounder'
      and (
        d.review_status <> 'approved'
        or s.evidence_policy <> 'report_evidence'
      )
  ) then
    raise exception 'Eligible/context factor events require approved report-evidence documents'
      using errcode = '23514';
  end if;

  return null;
end
$$;

drop trigger if exists rto_factor_events_evidence_guard on rto_factor_events;
create constraint trigger rto_factor_events_evidence_guard
after insert on rto_factor_events
deferrable initially deferred
for each row execute function validate_rto_factor_event_evidence();

create or replace function validate_rto_factor_validation_insert()
returns trigger
language plpgsql
as $$
declare
  event_review_status text;
  current_report_status text;
  current_batch_status text;
  current_revision integer;
  current_source_checksum text;
  current_source_snapshot_date date;
  event_effective_start date;
  event_expected_direction text;
  frozen_control_count integer;
begin
  select
    e.review_status,
    e.effective_start,
    e.expected_direction,
    r.status,
    b.status,
    b.revision,
    b.source_checksum,
    b.source_snapshot_date
  into
    event_review_status,
    event_effective_start,
    event_expected_direction,
    current_report_status,
    current_batch_status,
    current_revision,
    current_source_checksum,
    current_source_snapshot_date
  from rto_factor_events e
  join rto_reports r on r.id = new.report_id
  join rto_report_batches b on b.id = r.batch_id
  where e.id = new.event_id;

  if not found then
    raise exception 'Validation event or report linkage is missing'
      using errcode = '23503';
  end if;

  if new.report_revision <> current_revision
     or new.report_source_checksum is distinct from current_source_checksum then
    raise exception 'Validation report revision or source checksum is stale'
      using errcode = '23514';
  end if;

  select count(*)::integer
  into frozen_control_count
  from rto_factor_validation_controls c
  where c.validation_id = new.id
    and c.exposure_status = 'unexposed';

  if new.control_count <> frozen_control_count then
    raise exception 'Validation control_count does not match the frozen unexposed controls'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from rto_factor_validation_documents vd
    left join rto_factor_event_documents ed
      on ed.event_id = new.event_id
     and ed.document_id = vd.document_id
     and ed.evidence_role = vd.evidence_role
    where vd.validation_id = new.id
      and ed.document_id is null
  ) then
    raise exception 'Validation evidence must preserve an event document and its evidence role'
      using errcode = '23514';
  end if;

  if new.decision_status in ('mixed_evidence', 'supported_association') then
    if event_review_status <> 'eligible' then
      raise exception 'Evidence-backed validation requires an eligible factor event'
        using errcode = '23514';
    end if;

    if current_report_status <> 'ready'
       or current_batch_status <> 'ready' then
      raise exception 'Evidence-backed validation requires a ready report and batch'
        using errcode = '23514';
    end if;

    if frozen_control_count < 5 then
      raise exception 'Evidence-backed validation requires at least five unexposed controls'
        using errcode = '23514';
    end if;

    if new.observed_date_coverage < 0.9 then
      raise exception 'Evidence-backed validation requires 90 percent window coverage'
        using errcode = '23514';
    end if;

    if new.pre_window_end - new.pre_window_start + 1 < 28
       or new.post_window_end - new.post_window_start + 1 < 14
       or new.pre_window_end + 1 <> new.post_window_start
       or new.post_window_start <> event_effective_start
       or new.post_window_end > current_source_snapshot_date then
      raise exception 'Evidence-backed validation windows are incomplete, misaligned, or newer than the report'
        using errcode = '23514';
    end if;

    if new.algorithm_key <> 'matched-rto-did' then
      raise exception 'Evidence-backed validation must use matched-rto-did'
        using errcode = '23514';
    end if;

    if new.decision_status = 'supported_association'
       and (
         new.effect_unit <> 'registrations_per_day'
         or new.baseline_value is null
         or new.focal_change is null
         or new.control_change is null
         or new.effect_size is distinct from new.focal_change - new.control_change
         or new.materiality_threshold is null
         or new.materiality_threshold < greatest(5, new.baseline_value * 0.1)
         or abs(new.effect_size) < new.materiality_threshold
         or (event_expected_direction = 'increase' and new.effect_size <= 0)
         or (event_expected_direction = 'decrease' and new.effect_size >= 0)
       ) then
      raise exception 'Supported association does not satisfy direction, DiD, or materiality rules'
        using errcode = '23514';
    end if;

    if not exists (
      select 1
      from rto_factor_validation_documents vd
      where vd.validation_id = new.id
        and vd.evidence_role = 'primary'
    ) then
      raise exception 'Evidence-backed validation requires primary evidence'
        using errcode = '23514';
    end if;

    if exists (
      select 1
      from rto_factor_validation_documents vd
      join rto_factor_documents d on d.id = vd.document_id
      join rto_factor_sources s on s.id = d.source_id
      where vd.validation_id = new.id
        and vd.evidence_role <> 'confounder'
        and (
          d.review_status <> 'approved'
          or s.evidence_policy <> 'report_evidence'
        )
    ) then
      raise exception 'Evidence-backed validation requires approved report-evidence documents'
        using errcode = '23514';
    end if;
  end if;

  return null;
end
$$;

drop trigger if exists rto_factor_validations_integrity_guard on rto_factor_validations;
create constraint trigger rto_factor_validations_integrity_guard
after insert on rto_factor_validations
deferrable initially deferred
for each row execute function validate_rto_factor_validation_insert();

create or replace function validate_rto_report_explanation_insert()
returns trigger
language plpgsql
as $$
declare
  validation_status text;
  expected_confidence text;
begin
  select decision_status
  into validation_status
  from rto_factor_validations
  where id = new.validation_id;

  expected_confidence := case validation_status
    when 'too_early' then 'too_early'
    when 'blocked_data' then 'blocked'
    when 'blocked_evidence' then 'blocked'
    when 'confounded' then 'weak'
    when 'no_effect' then 'contradicted_by_data'
    when 'mixed_evidence' then 'mixed_evidence'
    when 'supported_association' then 'supported'
    else null
  end;

  if new.confidence_label is distinct from expected_confidence then
    raise exception 'Explanation confidence does not match validation status %', validation_status
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from rto_report_explanation_documents xd
    where xd.explanation_id = new.id
  ) then
    raise exception 'Report explanation % requires at least one citation', new.id
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from rto_report_explanation_documents xd
    left join rto_factor_validation_documents vd
      on vd.validation_id = new.validation_id
     and vd.document_id = xd.document_id
    where xd.explanation_id = new.id
      and vd.document_id is null
  ) then
    raise exception 'Explanation citations must be frozen validation documents'
      using errcode = '23514';
  end if;

  return null;
end
$$;

drop trigger if exists rto_report_explanations_integrity_guard on rto_report_explanations;
create constraint trigger rto_report_explanations_integrity_guard
after insert on rto_report_explanations
deferrable initially deferred
for each row execute function validate_rto_report_explanation_insert();

create or replace function validate_rto_report_explanation_review_insert()
returns trigger
language plpgsql
as $$
declare
  explanation_record record;
  prior_decision text;
  citation_count integer;
  ineligible_citation_count integer;
begin
  if new.decision in ('approved', 'edited_and_approved') then
    select
      x.report_revision,
      x.report_source_checksum,
      v.decision_status,
      e.review_status as event_review_status,
      r.status as report_status,
      b.status as batch_status,
      b.revision as current_revision,
      b.source_checksum as current_source_checksum
    into explanation_record
    from rto_report_explanations x
    join rto_factor_validations v on v.id = x.validation_id
    join rto_factor_events e on e.id = v.event_id
    join rto_reports r on r.id = x.report_id
    join rto_report_batches b on b.id = r.batch_id
    where x.id = new.explanation_id;

    if not found then
      raise exception 'Report explanation % was not found', new.explanation_id
        using errcode = '23503';
    end if;

    if explanation_record.decision_status not in ('mixed_evidence', 'supported_association')
       or explanation_record.event_review_status <> 'eligible'
       or explanation_record.report_status <> 'ready'
       or explanation_record.batch_status <> 'ready' then
      raise exception 'Explanation is not eligible for approval'
        using errcode = '23514';
    end if;

    if explanation_record.report_revision <> explanation_record.current_revision
       or explanation_record.report_source_checksum is distinct from explanation_record.current_source_checksum then
      raise exception 'Explanation is stale and cannot be approved'
        using errcode = '23514';
    end if;

    select
      count(*)::integer,
      count(*) filter (
        where d.review_status <> 'approved'
           or s.evidence_policy <> 'report_evidence'
      )::integer
    into citation_count, ineligible_citation_count
    from rto_report_explanation_documents xd
    join rto_factor_documents d on d.id = xd.document_id
    join rto_factor_sources s on s.id = d.source_id
    where xd.explanation_id = new.explanation_id;

    if citation_count = 0 or ineligible_citation_count > 0 then
      raise exception 'Approved explanations require approved report-evidence citations'
        using errcode = '23514';
    end if;
  end if;

  if new.decision = 'revoked' then
    select decision
    into prior_decision
    from rto_report_explanation_reviews
    where explanation_id = new.explanation_id
    order by created_at desc, id desc
    limit 1;

    if prior_decision is null or prior_decision not in ('approved', 'edited_and_approved') then
      raise exception 'Only the latest approved explanation can be revoked'
        using errcode = '23514';
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists rto_report_explanation_reviews_integrity_guard on rto_report_explanation_reviews;
create trigger rto_report_explanation_reviews_integrity_guard
before insert on rto_report_explanation_reviews
for each row execute function validate_rto_report_explanation_review_insert();

drop trigger if exists rto_factor_sources_append_only on rto_factor_sources;
create trigger rto_factor_sources_append_only
before update or delete on rto_factor_sources
for each row execute function prevent_rto_factor_record_mutation();

drop trigger if exists rto_factor_documents_append_only on rto_factor_documents;
create trigger rto_factor_documents_append_only
before update or delete on rto_factor_documents
for each row execute function prevent_rto_factor_record_mutation();

drop trigger if exists rto_factor_events_append_only on rto_factor_events;
create trigger rto_factor_events_append_only
before update or delete on rto_factor_events
for each row execute function prevent_rto_factor_record_mutation();

drop trigger if exists rto_factor_event_documents_append_only on rto_factor_event_documents;
create trigger rto_factor_event_documents_append_only
before update or delete on rto_factor_event_documents
for each row execute function prevent_rto_factor_record_mutation();

drop trigger if exists rto_factor_event_targets_append_only on rto_factor_event_targets;
create trigger rto_factor_event_targets_append_only
before update or delete on rto_factor_event_targets
for each row execute function prevent_rto_factor_record_mutation();

drop trigger if exists rto_factor_validations_append_only on rto_factor_validations;
create trigger rto_factor_validations_append_only
before update or delete on rto_factor_validations
for each row execute function prevent_rto_factor_record_mutation();

drop trigger if exists rto_factor_validation_controls_append_only on rto_factor_validation_controls;
create trigger rto_factor_validation_controls_append_only
before update or delete on rto_factor_validation_controls
for each row execute function prevent_rto_factor_record_mutation();

drop trigger if exists rto_factor_validation_documents_append_only on rto_factor_validation_documents;
create trigger rto_factor_validation_documents_append_only
before update or delete on rto_factor_validation_documents
for each row execute function prevent_rto_factor_record_mutation();

drop trigger if exists rto_report_explanations_append_only on rto_report_explanations;
create trigger rto_report_explanations_append_only
before update or delete on rto_report_explanations
for each row execute function prevent_rto_factor_record_mutation();

drop trigger if exists rto_report_explanation_documents_append_only on rto_report_explanation_documents;
create trigger rto_report_explanation_documents_append_only
before update or delete on rto_report_explanation_documents
for each row execute function prevent_rto_factor_record_mutation();

drop trigger if exists rto_report_explanation_reviews_append_only on rto_report_explanation_reviews;
create trigger rto_report_explanation_reviews_append_only
before update or delete on rto_report_explanation_reviews
for each row execute function prevent_rto_factor_record_mutation();
