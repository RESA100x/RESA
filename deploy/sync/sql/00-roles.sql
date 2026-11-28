-- Roles PostgREST and GoTrue log in as. Created once, before either service
-- starts, because both refuse to boot without them.
create role supabase_auth_admin login password 'resa_auth_dev_password' noinherit createrole;
create schema if not exists auth authorization supabase_auth_admin;
grant all on schema auth to supabase_auth_admin;

create role authenticator login password 'resa_auth_dev_password' noinherit;
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to authenticated, service_role;
alter default privileges in schema public grant all on sequences to authenticated, service_role;
