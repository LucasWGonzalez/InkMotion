alter table public.stories
  add column if not exists video_path text unique;

alter table public.stories
  add constraint stories_video_path_owner_check
  check (video_path is null or video_path like author_id::text || '/' || id::text || '/%');

update storage.buckets
set file_size_limit = 15728640,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','application/octet-stream']
where id = 'stories';

drop policy if exists "authors upload only inside their folder" on storage.objects;
create policy "authors upload only inside their folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'stories'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (
    name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/cover\.(jpg|jpeg|png|webp)$'
    or name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/animation\.mp4$'
    or name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/target\.mind$'
  )
);
