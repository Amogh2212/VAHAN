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
