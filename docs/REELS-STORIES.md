# Reels and Stories — v0.1.19

- Composer supports Instagram Reel (MP4 video) and Instagram Story (image or MP4).
- Cloud-connected accounts can upload MP4 files up to 100 MB to Meta Manager's public Supabase Storage bucket.
- Cloud schedule queues media type (`feed`, `reel`, or `story`) and the worker creates the corresponding Instagram publishing container.
- Local schedules need Meta Manager running; Cloud schedules use the existing worker and connected credentials.
- Existing cloud jobs and feed posts retain `feed` as the default media type.
- The account must have the necessary Instagram publishing permissions and valid access token. Instagram processing and publishing can fail on incompatible media or access limitations; errors are retained for review rather than repeatedly reposting.
- Deploy `cloud/002_reels_stories.sql` and the updated `meta-manager-cloud` Edge Function before using cloud Reel/Story publishing. Deployed to the connected Supabase project on 2026-10-13.
- Real-account publication was deliberately not exercised during implementation.

Linux installation:

```bash
sudo apt install ./Meta-Manager-0.1.19-Linux-amd64.deb
```
