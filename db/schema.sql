create table if not exists registrations (
  id bigserial primary key,
  year integer not null check (year between 2000 and 2100),
  month integer not null check (month between 1 and 12),
  state text not null,
  rto text not null,
  fuel_segment text not null,
  fuel_type text not null,
  vehicle_count integer not null check (vehicle_count >= 0),
  source_url text not null,
  scraped_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (year, month, state, rto, fuel_type)
);

create index if not exists registrations_filter_idx
  on registrations (state, rto, year, month);

create index if not exists registrations_fuel_idx
  on registrations (fuel_segment, fuel_type);
