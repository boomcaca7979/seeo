-- ===== 0002_auth_isolation.sql =====
-- 幂等合并迁移：profiles + projects + user_projects + RLS + 触发器
-- 合并 0001_init.sql 全部内容并补全：缺失 profile 回填、policy drop-if-exists 幂等化
-- 可重复执行，不报错

-- ============ profiles 表 ============
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- 回填：注册时 profiles 表不存在导致缺失的 auth.users 用户补 profile
insert into public.profiles (id, email, display_name)
select au.id, au.email, split_part(au.email, '@', 1)
from auth.users au
left join public.profiles p on p.id = au.id
where p.id is null
on conflict (id) do nothing;

-- ============ handle_new_user 触发器 ============
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ projects 表 ============
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  domain text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ projects updated_at 触发器 ============
create or replace function public.update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_updated_at on public.projects;
create trigger projects_updated_at
  before update on public.projects
  for each row execute function public.update_updated_at();

-- ============ RLS: profiles ============
alter table public.profiles enable row level security;

drop policy if exists "Profiles are viewable by owner" on public.profiles;
create policy "Profiles are viewable by owner"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Profiles are updatable by owner" on public.profiles;
create policy "Profiles are updatable by owner"
  on public.profiles for update
  using (auth.uid() = id);

-- ============ RLS: projects ============
alter table public.projects enable row level security;

drop policy if exists "Projects are viewable by owner" on public.projects;
create policy "Projects are viewable by owner"
  on public.projects for select
  using (auth.uid() = user_id);

drop policy if exists "Projects are insertable by owner" on public.projects;
create policy "Projects are insertable by owner"
  on public.projects for insert
  with check (auth.uid() = user_id);

drop policy if exists "Projects are updatable by owner" on public.projects;
create policy "Projects are updatable by owner"
  on public.projects for update
  using (auth.uid() = user_id);

drop policy if exists "Projects are deletable by owner" on public.projects;
create policy "Projects are deletable by owner"
  on public.projects for delete
  using (auth.uid() = user_id);

-- ============ user_projects 表 ============
create table if not exists public.user_projects (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  unique(user_id, project_id)
);

alter table public.user_projects enable row level security;

drop policy if exists "Users can view own project links" on public.user_projects;
create policy "Users can view own project links"
  on public.user_projects for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own project links" on public.user_projects;
create policy "Users can insert own project links"
  on public.user_projects for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own project links" on public.user_projects;
create policy "Users can delete own project links"
  on public.user_projects for delete
  using (auth.uid() = user_id);

-- ============ handle_new_project 触发器 ============
create or replace function public.handle_new_project()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.user_projects (user_id, project_id, role)
  values (new.user_id, new.id, 'owner')
  on conflict (user_id, project_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_project_created on public.projects;
create trigger on_project_created
  after insert on public.projects
  for each row execute function public.handle_new_project();
