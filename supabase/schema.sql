-- Dedicated project only. No real notebook data, emails, or credentials belong here.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create table public.notebooks (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'ジュンの野球ノート' check (char_length(title) between 1 and 100),
  created_at timestamptz not null default now()
);
create table public.memberships (
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('manager', 'writer', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (notebook_id, user_id)
);
create unique index memberships_one_writer on public.memberships(notebook_id) where role = 'writer';
create unique index memberships_one_manager on public.memberships(notebook_id) where role = 'manager';
create index memberships_user_id on public.memberships(user_id, notebook_id);

create function private.valid_notes(p_notes jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare n jsonb; r jsonb; k text; ids text[] := '{}'; review_ids text[]; cats text[];
begin
  if p_notes is null or jsonb_typeof(p_notes) <> 'array' then return false; end if;
  if jsonb_array_length(p_notes) > 3000 or octet_length(p_notes::text) > 5242880 then return false; end if;
  for n in select value from jsonb_array_elements(p_notes) loop
    if jsonb_typeof(n) <> 'object' or not (n ?& array['id','date','type','categories','good','improve','goal','action','amount','feeling','goalDone','actionDone','goalDoneAt','actionDoneAt','createdAt','updatedAt','reviews']) then return false; end if;
    if (n - array['id','date','type','categories','good','improve','goal','action','amount','feeling','goalDone','actionDone','goalDoneAt','actionDoneAt','createdAt','updatedAt','reviews']) <> '{}'::jsonb then return false; end if;
    for k in select unnest(array['id','date','type','good','improve','goal','action','amount','feeling','createdAt','updatedAt']) loop
      if jsonb_typeof(n->k) <> 'string' then return false; end if;
    end loop;
    -- Legacy backups used safe string IDs; new clients generate UUIDs.
    if n->>'id' !~ '^[A-Za-z0-9_-]{1,80}$' or n->>'id' = any(ids) then return false; end if;
    ids := array_append(ids, n->>'id');
    if n->>'date' !~ '^\d{4}-\d{2}-\d{2}$' or n->>'date' < '1900-01-01' or n->>'date' > '2100-12-31' or (n->>'date')::date::text <> n->>'date' then return false; end if;
    if n->>'type' not in ('練習','試合','自主練') or n->>'feeling' not in ('','よかった','ふつう','むずかしかった') then return false; end if;
    if jsonb_typeof(n->'categories') <> 'array' or jsonb_array_length(n->'categories') > 5 then return false; end if;
    cats := '{}';
    for r in select value from jsonb_array_elements(n->'categories') loop
      if jsonb_typeof(r) <> 'string' or r #>> '{}' not in ('打撃','守備','走塁','投球','その他') or r #>> '{}' = any(cats) then return false; end if;
      cats := array_append(cats, r #>> '{}');
    end loop;
    if char_length(n->>'good') > 1600 or char_length(n->>'improve') > 1600 or char_length(n->>'goal') > 300 or char_length(n->>'action') > 300 or char_length(n->>'amount') > 100 then return false; end if;
    if btrim(n->>'good') = '' and btrim(n->>'improve') = '' then return false; end if;
    if (btrim(n->>'action') <> '' and btrim(n->>'goal') = '') or (btrim(n->>'amount') <> '' and btrim(n->>'action') = '') then return false; end if;
    for k in select unnest(array['goalDone','actionDone']) loop
      if jsonb_typeof(n->k) <> 'boolean' then return false; end if;
    end loop;
    if (n->>'goalDone')::boolean and btrim(n->>'goal') = '' then return false; end if;
    if (n->>'actionDone')::boolean and btrim(n->>'action') = '' then return false; end if;
    for k in select unnest(array['createdAt','updatedAt','goalDoneAt','actionDoneAt']) loop
      if n->k = 'null'::jsonb and k in ('goalDoneAt','actionDoneAt') then continue; end if;
      if jsonb_typeof(n->k) <> 'string' or n->>k !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' or not isfinite((n->>k)::timestamptz) then return false; end if;
    end loop;
    if (n->>'updatedAt')::timestamptz < (n->>'createdAt')::timestamptz then return false; end if;
    if jsonb_typeof(n->'reviews') <> 'array' or jsonb_array_length(n->'reviews') > 6 then return false; end if;
    review_ids := '{}';
    for r in select value from jsonb_array_elements(n->'reviews') loop
      if jsonb_typeof(r) <> 'object' or not (r ?& array['id','text','status']) or (r - array['id','text','status']) <> '{}'::jsonb then return false; end if;
      if jsonb_typeof(r->'id') <> 'string' or r->>'id' !~ '^[A-Za-z0-9_-]{1,80}$' or r->>'id' = any(review_ids) or jsonb_typeof(r->'text') <> 'string' or char_length(r->>'text') > 450 or jsonb_typeof(r->'status') <> 'string' or r->>'status' not in ('done','partial','notyet') then return false; end if;
      review_ids := array_append(review_ids, r->>'id');
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$$;
revoke all on function private.valid_notes(jsonb) from public, anon, authenticated;
grant execute on function private.valid_notes(jsonb) to service_role;

create table public.notebook_documents (
  notebook_id uuid primary key references public.notebooks(id) on delete cascade,
  revision integer not null default 0 check (revision >= 0),
  notes jsonb not null default '[]'::jsonb check (private.valid_notes(notes)),
  updated_at timestamptz not null default now()
);

alter table public.notebooks enable row level security;
alter table public.memberships enable row level security;
alter table public.notebook_documents enable row level security;
revoke all on public.notebooks, public.memberships, public.notebook_documents from anon, authenticated;
grant select on public.notebooks, public.memberships, public.notebook_documents to authenticated;
grant all on public.notebooks, public.memberships, public.notebook_documents to service_role;

create policy own_membership on public.memberships for select to authenticated
  using (user_id = (select auth.uid()));
create policy member_reads_notebook on public.notebooks for select to authenticated
  using (exists (select 1 from public.memberships m where m.notebook_id = notebooks.id and m.user_id = (select auth.uid())));
create policy member_reads_document on public.notebook_documents for select to authenticated
  using (exists (select 1 from public.memberships m where m.notebook_id = notebook_documents.notebook_id and m.user_id = (select auth.uid())));

create function private.document_revision_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.notebook_id <> old.notebook_id or new.revision <> old.revision + 1 then
    raise exception using errcode = '23514', message = 'INVALID_DOCUMENT_REVISION';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.document_revision_guard() from public, anon, authenticated;
create trigger document_revision_guard before update on public.notebook_documents
  for each row execute function private.document_revision_guard();

-- No direct client UPDATE grant: every client write must supply an expected revision.
-- The definer is private/non-exposed, explicitly checks auth.uid and current membership.
create function private.save_notebook(p_notebook_id uuid, p_expected_revision integer, p_notes jsonb)
returns public.notebook_documents language plpgsql security definer set search_path = '' as $$
declare doc public.notebook_documents; current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  -- SHARE lock makes membership removal and a save have an unambiguous ordering.
  perform 1 from public.memberships where notebook_id = p_notebook_id and user_id = current_user_id and role = 'writer' for share;
  if not found then raise exception using errcode = '42501', message = 'WRITER_REQUIRED'; end if;
  select * into doc from public.notebook_documents where notebook_id = p_notebook_id for update;
  if not found then raise exception using errcode = '42501', message = 'NOTEBOOK_UNAVAILABLE'; end if;
  if p_expected_revision is null or doc.revision <> p_expected_revision then raise exception using errcode = 'P0001', message = 'NOTEBOOK_CONFLICT'; end if;
  if not private.valid_notes(p_notes) then raise exception using errcode = '22023', message = 'INVALID_NOTES'; end if;
  update public.notebook_documents set notes = p_notes, revision = revision + 1 where notebook_id = p_notebook_id returning * into doc;
  return doc;
end;
$$;
revoke all on function private.save_notebook(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function private.save_notebook(uuid, integer, jsonb) to authenticated;
create function public.save_notebook(p_notebook_id uuid, p_expected_revision integer, p_notes jsonb)
returns public.notebook_documents language sql security invoker set search_path = '' as $$
  select private.save_notebook(p_notebook_id, p_expected_revision, p_notes);
$$;
revoke all on function public.save_notebook(uuid, integer, jsonb) from public, anon;
grant execute on function public.save_notebook(uuid, integer, jsonb) to authenticated;

-- A lease serializes the multi-request Auth + membership invitation transaction.
-- Token generation may leave an unassociated Auth account on interruption, but a link
-- is never returned until membership commit. Retrying safely recovers that account.
create table private.family_admin_leases (
  notebook_id uuid primary key references public.notebooks(id) on delete cascade,
  token uuid not null,
  actor_user_id uuid not null,
  expires_at timestamptz not null
);
alter table private.family_admin_leases enable row level security;
revoke all on private.family_admin_leases from public, anon, authenticated;

create function private.family_admin_operation(p_notebook_id uuid, p_actor_user_id uuid, p_action text, p_token uuid default null, p_target_user_id uuid default null, p_role text default null, p_email text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare lease private.family_admin_leases; result jsonb; new_token uuid; existing_role text;
begin
  if p_actor_user_id is null then raise exception using errcode = '42501', message = 'MANAGER_REQUIRED'; end if;
  -- Lock the notebook for all administrative operations, including concurrent lease creation.
  perform 1 from public.notebooks where id = p_notebook_id for update;
  if not found or not exists (select 1 from public.memberships where notebook_id = p_notebook_id and user_id = p_actor_user_id and role = 'manager') then
    raise exception using errcode = '42501', message = 'MANAGER_REQUIRED';
  end if;
  if p_action = 'list' then
    select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'role',m.role) order by m.created_at),'[]'::jsonb) into result
      from public.memberships m join auth.users u on u.id = m.user_id where m.notebook_id = p_notebook_id;
    return jsonb_build_object('members',result);
  end if;
  if p_action = 'begin' then
    select * into lease from private.family_admin_leases where notebook_id = p_notebook_id;
    if found and lease.expires_at > clock_timestamp() then raise exception using errcode = 'P0001', message = 'ADMIN_BUSY'; end if;
    new_token := gen_random_uuid();
    insert into private.family_admin_leases values(p_notebook_id,new_token,p_actor_user_id,clock_timestamp() + interval '60 seconds')
      on conflict (notebook_id) do update set token=excluded.token,actor_user_id=excluded.actor_user_id,expires_at=excluded.expires_at;
    return jsonb_build_object('token',new_token);
  end if;
  select * into lease from private.family_admin_leases where notebook_id = p_notebook_id;
  if not found or p_token is null or lease.token <> p_token or lease.actor_user_id <> p_actor_user_id or lease.expires_at <= clock_timestamp() then
    raise exception using errcode = '42501', message = 'ADMIN_LEASE_EXPIRED';
  end if;
  if p_action = 'lookup' then
    select jsonb_build_object('user_id',u.id,'email',u.email,'role',m.role) into result from auth.users u
      left join public.memberships m on m.user_id = u.id and m.notebook_id = p_notebook_id where lower(u.email) = lower(p_email);
    return jsonb_build_object('user',result,'writer_exists',exists(select 1 from public.memberships where notebook_id=p_notebook_id and role='writer'));
  end if;
  if p_action = 'release' then
    delete from private.family_admin_leases where notebook_id = p_notebook_id and token = p_token;
    return jsonb_build_object('ok',true);
  end if;
  if p_target_user_id is null then raise exception using errcode = '22023', message = 'INVALID_TARGET'; end if;
  select role into existing_role from public.memberships where notebook_id = p_notebook_id and user_id = p_target_user_id;
  if p_action = 'add' then
    if p_role is null or p_role not in ('writer','viewer') then raise exception using errcode = '22023', message = 'INVALID_ROLE'; end if;
    if existing_role is not null then raise exception using errcode = 'P0001', message = 'ALREADY_MEMBER'; end if;
    if (select count(*) from public.memberships where notebook_id = p_notebook_id) >= 30 then raise exception using errcode = 'P0001', message = 'FAMILY_LIMIT'; end if;
    if p_role = 'writer' and exists(select 1 from public.memberships where notebook_id = p_notebook_id and role='writer') then raise exception using errcode = 'P0001', message = 'WRITER_EXISTS'; end if;
    insert into public.memberships(notebook_id,user_id,role) values(p_notebook_id,p_target_user_id,p_role);
  elsif p_action = 'recovery' then
    if existing_role is null or existing_role = 'manager' then raise exception using errcode = '42501', message = 'INVALID_RECOVERY_TARGET'; end if;
  elsif p_action = 'remove' then
    if p_target_user_id = p_actor_user_id or existing_role = 'manager' then raise exception using errcode = '42501', message = 'CANNOT_REMOVE_MANAGER'; end if;
    if existing_role is null then raise exception using errcode = '22023', message = 'MEMBER_NOT_FOUND'; end if;
    delete from public.memberships where notebook_id=p_notebook_id and user_id=p_target_user_id;
  else raise exception using errcode = '22023', message = 'INVALID_ACTION';
  end if;
  delete from private.family_admin_leases where notebook_id = p_notebook_id and token = p_token;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function private.family_admin_operation(uuid,uuid,text,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function private.family_admin_operation(uuid,uuid,text,uuid,uuid,text,text) to service_role;
create function public.family_admin_operation(p_notebook_id uuid, p_actor_user_id uuid, p_action text, p_token uuid default null, p_target_user_id uuid default null, p_role text default null, p_email text default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.family_admin_operation(p_notebook_id,p_actor_user_id,p_action,p_token,p_target_user_id,p_role,p_email);
$$;
revoke all on function public.family_admin_operation(uuid,uuid,text,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.family_admin_operation(uuid,uuid,text,uuid,uuid,text,text) to service_role;

comment on function public.save_notebook(uuid,integer,jsonb) is 'Writer only, current membership checked. Expected revision required; P0001 NOTEBOOK_CONFLICT means refresh before retry.';
comment on function public.family_admin_operation(uuid,uuid,text,uuid,uuid,text,text) is 'Service role only. Edge function must validate the actor JWT via auth.getUser before passing actor ID.';
commit;
