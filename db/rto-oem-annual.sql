create table if not exists rto_oem_annual_collection_runs (
  id bigserial primary key,
  source_cohort_run_id bigint not null,
  cohort_hash text not null,
  cohort jsonb not null check (jsonb_array_length(cohort) = 100),
  calendar_year integer not null check (calendar_year between 1900 and 9999),
  observation_date date not null,
  status text not null default 'running' check (status in ('running','partial','success','failed')),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check (extract(year from observation_date)::int = calendar_year)
);

create table if not exists rto_oem_annual_observations (
  run_id bigint not null references rto_oem_annual_collection_runs(id),
  state text not null,
  rto text not null,
  fuel_group text not null check (fuel_group in ('EV','ICE')),
  vehicle_category text not null check (vehicle_category in ('2W','3W','4W')),
  calendar_year integer not null,
  observation_date date not null,
  observed_at timestamptz not null,
  status text not null check (status in ('verified','unavailable')),
  evidence jsonb not null,
  error_reason text,
  primary key (run_id,state,rto,fuel_group,vehicle_category),
  check (extract(year from observation_date)::int = calendar_year),
  check ((status='verified' and evidence->>'contract'='public-registration-calendar-year-v1' and error_reason is null)
    or (status='unavailable' and length(error_reason)>0))
);
create index if not exists rto_oem_annual_lookup_idx
  on rto_oem_annual_observations (state,rto,calendar_year,observation_date desc,observed_at desc);
