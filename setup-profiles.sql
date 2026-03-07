-- Profiles table — stores plan per user (gratis/bas/pro)
create table if not exists profiles (
  id   uuid references auth.users on delete cascade primary key,
  plan text not null default 'gratis',
  created_at timestamptz not null default now()
);

-- Row-level security: users can only read/update their own row
alter table profiles enable row level security;

create policy "Users can read own profile"
  on profiles for select using (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

-- Auto-create a 'gratis' profile row when a new user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, plan) values (new.id, 'gratis');
  return new;
end;
$$;

-- Drop trigger if it already exists, then recreate
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
