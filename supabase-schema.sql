-- Run this in your Supabase project → SQL Editor → New query
-- It creates the single table the app needs.

create table if not exists trip_data (
  trip_id    text primary key,
  payload    jsonb not null,
  updated_at timestamptz default now()
);

-- Allow anonymous reads and writes (no login required — the trip_id acts as the access key)
alter table trip_data enable row level security;

create policy "Anyone can read trip data"
  on trip_data for select using (true);

create policy "Anyone can insert trip data"
  on trip_data for insert with check (true);

create policy "Anyone can update trip data"
  on trip_data for update using (true);

-- Enable real-time so all phones see changes instantly
alter publication supabase_realtime add table trip_data;
