-- Fixed historical selection is independent of the actual collection date.
create table if not exists rto_oem_tracking_baselines (
  id bigserial primary key,
  source_cohort_run_id bigint not null,
  selection_year integer not null check (selection_year between 1900 and 9999),
  cohort_hash text not null,
  cohort jsonb not null check (jsonb_array_length(cohort)=100),
  status text not null default 'running' check (status in ('running','partial','success','failed')),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  activated_at timestamptz
);
create unique index if not exists rto_oem_tracking_one_active on rto_oem_tracking_baselines (is_active) where is_active;

create or replace function protect_oem_tracking_baseline_identity() returns trigger language plpgsql as $$
begin
  if (new.source_cohort_run_id,new.selection_year,new.cohort_hash,new.cohort) is distinct from
    (old.source_cohort_run_id,old.selection_year,old.cohort_hash,old.cohort) then
    raise exception 'OEM baseline cohort and selection year are immutable';
  end if;
  return new;
end $$;
drop trigger if exists protect_oem_tracking_baseline_identity on rto_oem_tracking_baselines;
create trigger protect_oem_tracking_baseline_identity before update on rto_oem_tracking_baselines for each row execute function protect_oem_tracking_baseline_identity();

create table if not exists rto_oem_tracking_scopes (
  baseline_id bigint not null references rto_oem_tracking_baselines(id),
  state text not null,
  rto text not null,
  fuel_group text not null check (fuel_group in ('EV','ICE')),
  vehicle_category text not null check (vehicle_category in ('2W','3W','4W')),
  status text not null default 'pending' check (status in ('pending','verified','unavailable')),
  ranking_complete boolean not null default false,
  explicit_zero boolean not null default false,
  observed_at timestamptz,
  evidence jsonb,
  evidence_hash text,
  raw_responses jsonb,
  error_reason text,
  primary key (baseline_id,state,rto,fuel_group,vehicle_category),
  check ((status='verified' and evidence->>'contract'='public-oem-tracking-baseline-v1' and evidence_hash is not null and observed_at is not null and error_reason is null)
    or status='pending' or (status='unavailable' and length(error_reason)>0))
);

create table if not exists rto_oem_tracking_makers (
  baseline_id bigint not null,
  state text not null,
  rto text not null,
  fuel_group text not null,
  vehicle_category text not null,
  maker_id text not null check (length(maker_id)>0),
  maker_name text not null check (length(maker_name)>0),
  baseline_rank integer not null check (baseline_rank between 1 and 5),
  baseline_count bigint not null check (baseline_count>=0),
  primary key (baseline_id,state,rto,fuel_group,vehicle_category,maker_id),
  unique (baseline_id,state,rto,fuel_group,vehicle_category,baseline_rank),
  foreign key (baseline_id,state,rto,fuel_group,vehicle_category) references rto_oem_tracking_scopes(baseline_id,state,rto,fuel_group,vehicle_category)
);

create table if not exists rto_oem_tracking_daily_runs (
  id bigserial primary key,
  baseline_id bigint not null references rto_oem_tracking_baselines(id),
  observation_date date not null,
  calendar_year integer not null,
  status text not null default 'running' check (status in ('running','partial','success','failed')),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  error_reason text,
  unique (baseline_id,observation_date),
  check (extract(year from observation_date)::integer=calendar_year)
);

create table if not exists rto_oem_tracking_observations (
  baseline_id bigint not null,
  state text not null,
  rto text not null,
  fuel_group text not null,
  vehicle_category text not null,
  maker_id text not null,
  observation_date date not null,
  calendar_year integer not null,
  run_id bigint not null references rto_oem_tracking_daily_runs(id),
  observed_at timestamptz not null,
  status text not null check (status in ('verified','unavailable')),
  cumulative_count bigint check (cumulative_count>=0),
  source_reported_at timestamptz,
  filter_identity text,
  evidence jsonb,
  evidence_hash text,
  raw_responses jsonb,
  error_reason text,
  primary key (baseline_id,state,rto,fuel_group,vehicle_category,maker_id,observation_date),
  foreign key (baseline_id,state,rto,fuel_group,vehicle_category,maker_id) references rto_oem_tracking_makers(baseline_id,state,rto,fuel_group,vehicle_category,maker_id),
  check (extract(year from observation_date)::integer=calendar_year),
  check ((observed_at at time zone 'Asia/Kolkata')::date=observation_date),
  check ((status='verified' and evidence->>'contract'='public-oem-tracking-ytd-v1' and cumulative_count is not null and filter_identity is not null and evidence_hash is not null and error_reason is null)
    or (status='unavailable' and cumulative_count is null and length(error_reason)>0))
);
create index if not exists rto_oem_tracking_observation_date_idx on rto_oem_tracking_observations (observation_date,state,rto);

-- Reject changing verified evidence or selected identities, including direct SQL writes.
-- Raw bodies can still be pruned independently of the compact proof.
create table if not exists rto_oem_tracking_observation_history (
  id bigserial primary key,
  replaced_at timestamptz not null default now(),
  previous_observation jsonb not null
);
create table if not exists rto_oem_tracking_refresh_attempts (
  id bigserial primary key,
  baseline_id bigint not null references rto_oem_tracking_baselines(id),
  run_id bigint not null references rto_oem_tracking_daily_runs(id),
  observation_date date not null,
  state text not null, rto text not null, fuel_group text not null, vehicle_category text not null,
  attempted_at timestamptz not null default now(),
  status text not null check (status in ('verified','failed')),
  error_reason text
);
create index if not exists rto_oem_tracking_refresh_scope_idx on rto_oem_tracking_refresh_attempts
  (baseline_id,state,rto,fuel_group,vehicle_category,observation_date,attempted_at desc,id desc);
create or replace function protect_oem_refresh_history() returns trigger language plpgsql as $$
begin raise exception 'OEM refresh history is immutable'; end $$;
drop trigger if exists protect_oem_refresh_history on rto_oem_tracking_observation_history;
create trigger protect_oem_refresh_history before update or delete on rto_oem_tracking_observation_history
  for each row execute function protect_oem_refresh_history();
create or replace function protect_verified_oem_tracking() returns trigger language plpgsql as $$
begin
  if old.status='verified' and (to_jsonb(new)-'raw_responses') is distinct from (to_jsonb(old)-'raw_responses') then
    raise exception 'Verified OEM tracking evidence is immutable';
  end if;
  return new;
end $$;
drop trigger if exists protect_verified_oem_tracking_scope on rto_oem_tracking_scopes;
create trigger protect_verified_oem_tracking_scope before update on rto_oem_tracking_scopes for each row execute function protect_verified_oem_tracking();
create or replace function protect_oem_daily_refresh() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then
    if old.status='verified' then
      if current_setting('vahan.oem_retention',true) is distinct from 'on'
        then raise exception 'Verified OEM tracking evidence is immutable'; end if;
      insert into rto_oem_tracking_observation_history(previous_observation) values (to_jsonb(old)-'raw_responses');
    end if;
    return old;
  end if;
  if old.status='verified' and (to_jsonb(new)-'raw_responses') is distinct from (to_jsonb(old)-'raw_responses') then
    if current_setting('vahan.oem_refresh',true) is distinct from 'on'
      or new.status<>'verified' or new.observed_at<=old.observed_at
      or (new.baseline_id,new.state,new.rto,new.fuel_group,new.vehicle_category,new.maker_id,new.observation_date,new.calendar_year,new.filter_identity)
        is distinct from
         (old.baseline_id,old.state,old.rto,old.fuel_group,old.vehicle_category,old.maker_id,old.observation_date,old.calendar_year,old.filter_identity)
    then raise exception 'Verified OEM tracking evidence is immutable; refresh requires newer compatible verified evidence'; end if;
    insert into rto_oem_tracking_observation_history(previous_observation) values (to_jsonb(old)-'raw_responses');
  end if;
  return new;
end $$;
drop trigger if exists protect_verified_oem_tracking_observation on rto_oem_tracking_observations;
create trigger protect_verified_oem_tracking_observation before update or delete on rto_oem_tracking_observations
  for each row execute function protect_oem_daily_refresh();
create or replace function protect_selected_oem_tracking() returns trigger language plpgsql as $$
begin
  raise exception 'Selected OEM identity and rank are immutable; create a new baseline version';
end $$;
drop trigger if exists protect_selected_oem_tracking_maker on rto_oem_tracking_makers;
create trigger protect_selected_oem_tracking_maker before update or delete on rto_oem_tracking_makers for each row execute function protect_selected_oem_tracking();
