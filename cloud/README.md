# Meta Manager Cloud — Free Infrastructure

The existing Vercel authentication service remains in place. The always-on posting queue runs in the already active Supabase Free project, without creating a new paid project.

## Architecture
- Edge Function: meta-manager-cloud, verified by JWT for users or a Vault-backed secret for the internal worker.
- Queue: public.mm_cloud_posts with RLS enabled and no anon/authenticated table access.
- Publishing credentials: encrypted using pgcrypto and a key stored in Supabase Vault, accessible only through restricted service-role RPCs.
- Image hosting: public mm-public-media storage bucket, with per-user authenticated upload access and 10 MB file limit.
- Worker: pg_cron every minute invokes an Edge Function via pg_net. Claims are atomic. Uncertain publishing outcomes are marked needs_review rather than blindly retried.

## Setup
1. Install Meta Manager v0.1.14.
2. Settings → Cloud Publishing → Email sign-in. Copy the email link without opening it, then paste it into the app's verification field. A six-digit code also works if the Supabase email template supports OTP.
3. Click Enable for each Facebook, Instagram or LinkedIn account you explicitly authorize for cloud publishing. Other tokens stay on the computer.
4. In the composer, select free Cloud Scheduler. Uploaded JPEG images receive public Supabase HTTPS URLs.
5. Refresh cloud queue for results. Revoke removes a provider's encrypted credentials and cancels pending jobs. Signing out only removes the desktop session.

ChatGPT MCP supports cloud_status, list_cloud_posts, schedule_cloud_post, create_cloud_post and upload_cloud_media. Publishing and uploading through MCP require explicit confirm=true.

## Free quotas / caveats
The free Supabase plan currently offers 500,000 Edge Function invocations per month, 1 GB Storage, 500 MB database size per project, and 5 GB cached plus 5 GB uncached egress shared across the organization. One worker check per minute is at most 44,640 checks during a 31-day month, within the Edge Function quota by itself. The publishing service caps pending posts per owner at 200 and image files at 10 MB. Existing Advertpreneur Connect usage shares quotas. No billing upgrades, add-ons or paid plans are enabled by this integration.

Social tokens can expire and platforms can reject live publishing for permission reasons. Automated retries of ambiguous posts are deliberately disabled to avoid duplicate posts. The old Vercel OAuth broker remains unchanged.

Do not run the SQL migration again blindly. To disable the worker without touching queue data, use the authorized Supabase SQL interface and unschedule mm-cloud-publish-1m.
