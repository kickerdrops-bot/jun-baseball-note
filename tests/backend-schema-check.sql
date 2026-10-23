-- Read-only architecture checks; execute as project owner after schema.sql.
select table_name, privilege_type, grantee from information_schema.role_table_grants
where table_schema='public' and table_name in ('notebooks','memberships','notebook_documents')
and grantee in ('anon','authenticated','service_role') order by table_name,grantee,privilege_type;
select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname in ('public','private') order by schemaname,tablename,policyname;
select p.oid::regprocedure as function, p.prosecdef as security_definer, p.proconfig as settings,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.proname in ('save_notebook','family_admin_operation','valid_notes','document_revision_guard')
order by p.oid::regprocedure::text;
select c.oid::regclass as relation,c.relrowsecurity as rls_enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace
where (n.nspname='public' and c.relname in ('notebooks','memberships','notebook_documents')) or (n.nspname='private' and c.relname='family_admin_leases');
