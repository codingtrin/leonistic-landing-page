-- Contact form submissions from the Leonistic landing page.
create table if not exists public.signups (
    id          bigint generated always as identity primary key,
    name        text        not null,
    email       text        not null,
    message     text,
    created_at  timestamptz not null default now()
);

-- RLS intentionally disabled for now (no public client access yet).
alter table public.signups disable row level security;
