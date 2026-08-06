-- ===== SeeO 数据库迁移 =====
-- 在 Supabase Dashboard → SQL Editor 中执行此文件

-- ---------- profiles 表 ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- 新用户注册时自动插入 profile
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

-- ---------- projects 表 ----------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  domain text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at 自动更新
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

-- ---------- RLS 策略 ----------

-- profiles: 用户只能读写自己的 profile
alter table public.profiles enable row level security;

create policy "Profiles are viewable by owner"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Profiles are updatable by owner"
  on public.profiles for update
  using (auth.uid() = id);

-- projects: 用户只能读写自己的项目
alter table public.projects enable row level security;

create policy "Projects are viewable by owner"
  on public.projects for select
  using (auth.uid() = user_id);

create policy "Projects are insertable by owner"
  on public.projects for insert
  with check (auth.uid() = user_id);

create policy "Projects are updatable by owner"
  on public.projects for update
  using (auth.uid() = user_id);

create policy "Projects are deletable by owner"
  on public.projects for delete
  using (auth.uid() = user_id);

-- ---------- user_projects 多对多关联（可选，团队协作用） ----------
create table if not exists public.user_projects (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  unique(user_id, project_id)
);

alter table public.user_projects enable row level security;

create policy "Users can view own project links"
  on public.user_projects for select
  using (auth.uid() = user_id);

create policy "Users can insert own project links"
  on public.user_projects for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own project links"
  on public.user_projects for delete
  using (auth.uid() = user_id);

-- 新项目创建时自动给 owner 建立关联
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
