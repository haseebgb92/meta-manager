-- Track attempted first comments without republishing an already-successful post.
alter table public.mm_cloud_posts add column if not exists first_comment_status text not null default 'not_requested';
alter table public.mm_cloud_posts add column if not exists first_comment_id text;
alter table public.mm_cloud_posts add column if not exists first_comment_error text;
