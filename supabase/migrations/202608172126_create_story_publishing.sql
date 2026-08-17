create table public.stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null default 'Cuento sin título' check (char_length(title) between 1 and 120),
  image_path text not null unique,
  target_path text not null unique,
  config jsonb not null default '{"depthStrength":0.08,"animation":"magic-breathe","loopSeconds":5}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  check (image_path like author_id::text || '/' || id::text || '/%'),
  check (target_path like author_id::text || '/' || id::text || '/%')
);
create index stories_author_id_idx on public.stories (author_id);
alter table public.stories enable row level security;
grant select on public.stories to anon;
grant select, insert, update, delete on public.stories to authenticated;
create policy "published stories are publicly readable" on public.stories for select to anon, authenticated using (true);
create policy "authors publish their own stories" on public.stories for insert to authenticated with check ((select auth.uid()) = author_id);
create policy "authors update their own stories" on public.stories for update to authenticated using ((select auth.uid()) = author_id) with check ((select auth.uid()) = author_id);
create policy "authors delete their own stories" on public.stories for delete to authenticated using ((select auth.uid()) = author_id);
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values ('stories','stories',true,10485760,array['image/jpeg','image/png','image/webp','application/octet-stream']);
create policy "story assets are publicly readable" on storage.objects for select to anon, authenticated using (bucket_id='stories');
create policy "authors upload only inside their folder" on storage.objects for insert to authenticated with check (bucket_id='stories' and (storage.foldername(name))[1]=(select auth.uid())::text and (name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/cover\.(jpg|jpeg|png|webp)$' or name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/target\.mind$'));
create policy "authors delete files inside their folder" on storage.objects for delete to authenticated using (bucket_id='stories' and (storage.foldername(name))[1]=(select auth.uid())::text);
