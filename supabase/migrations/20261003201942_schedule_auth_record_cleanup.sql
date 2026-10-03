-- Migration: schedule_auth_record_cleanup
--
-- A daily pg_cron job deleting two kinds of record Supabase Auth keeps
-- indefinitely (Privacy FR-7, docs/specs/prd-privacy.md §12.3):
--
-- * auth.flow_state rows over a day old. One is written per sign-in and
--   needed only until that sign-in completes, but nothing removes it, and it
--   has no foreign key to auth.users, so it survives the user's deletion. A row
--   can hold the user's id and the GitHub access and refresh tokens.
-- * auth.sessions rows unused for 90 days, as hygiene. On the Free plan a
--   session lasts until sign-out -- time-boxed sessions and the inactivity
--   timeout are Pro settings -- and the session cookie lasts 400 days, so a
--   forgotten or stolen device would stay signed in indefinitely. This is the
--   inactivity timeout Free does not offer. Deleting the row is what sign-out
--   does: its refresh_tokens and mfa_amr_claims rows cascade, and that device
--   signs in again next time.
--
-- `refreshed_at` is a timestamp without a time zone, written in UTC, where
-- `updated_at` and `created_at` carry one; `greatest` ignores nulls, so a
-- session never refreshed is measured from the other two.
--
-- Both tables belong to supabase_auth_admin; postgres, which the job runs as,
-- holds DELETE on them on the local stack and the hosted project. The job
-- only deletes rows and never alters either table, so if Supabase adds a
-- cleanup of its own this one simply finds nothing to do.
--
-- pg_catalog is where Supabase's install instructions put pg_cron. Those
-- instructions also grant postgres usage on `cron` and all on its tables;
-- they are left out on purpose. Supabase's own after-create script for the
-- extension already gives postgres everything the job needs, and it runs
-- again on every `create extension if not exists`, where it revokes from
-- postgres on cron.job -- which fails with "dependent privileges exist" once
-- those extra grants are in place. Without them, replaying this succeeds, and
-- scheduling an existing job name replaces that job, so it leaves one job,
-- not two. Both checked on the local stack in rolled-back transactions.

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
    'delete-expired-auth-records',
    '17 3 * * *', -- daily, 03:17 UTC
    $$
        delete from auth.flow_state where created_at < now() - interval '1 day';
        delete from auth.sessions
         where greatest(refreshed_at at time zone 'UTC', updated_at, created_at)
               < now() - interval '90 days';
    $$
);
