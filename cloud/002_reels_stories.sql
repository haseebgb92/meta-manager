-- Apply to existing Meta Manager Supabase project before deploying the updated Edge Function.
alter table public.mm_cloud_posts add column if not exists content_type text not null default 'feed';
alter table public.mm_cloud_posts drop constraint if exists mm_cloud_posts_content_type_check;
alter table public.mm_cloud_posts add constraint mm_cloud_posts_content_type_check check(content_type in ('feed','reel','story'));
update storage.buckets set file_size_limit=104857600, allowed_mime_types=array['image/jpeg','image/png','image/webp','video/mp4'] where id='mm-public-media';
