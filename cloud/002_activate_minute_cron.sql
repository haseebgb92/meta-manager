-- Supabase Free minute scheduler, isolated and credentials kept in Vault.
create or replace function mm_private.invoke_worker()
returns bigint language sql security definer set search_path='' as $$
  select net.http_post(
    url:='https://hwhioqvsxazyxziyrhdg.supabase.co/functions/v1/meta-manager-cloud',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-mm-worker-token',
      (select decrypted_secret from vault.decrypted_secrets where name='mm_cloud_worker_key')
    ),
    body:='{"action":"tick"}'::jsonb,
    timeout_milliseconds:=65000
  )
$$;
revoke all on function mm_private.invoke_worker() from public, anon, authenticated;
select cron.schedule('mm-cloud-publish-1m','* * * * *','select mm_private.invoke_worker()');
