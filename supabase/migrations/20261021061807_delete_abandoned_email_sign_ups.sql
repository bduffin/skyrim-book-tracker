-- Migration: delete_abandoned_email_sign_ups
--
-- A daily pg_cron job deleting accounts an email sign-in created and nobody
-- confirmed (Email FR-7, Email Decision 14). Every code request for a new
-- address creates an unconfirmed account holding that address -- including an
-- address someone else typed, and an attacker's pre-registration -- so without
-- this the table keeps every address ever typed into the form.
--
-- An account counts only when all of these hold:
--
-- * Unconfirmed: `email_confirmed_at` is null.
-- * Its last code went out over a day ago. Measured from the latest code, not
--   `created_at`, so someone asking for a new code just after a day is not
--   deleted between the send and the check; a code lasts 10 minutes, so a
--   day-old unconfirmed account is never one a real sign-in is waiting on.
--   "Latest" covers both ways Auth sends one to an unconfirmed address: a
--   sign-in (`confirmation_sent_at`) and a password reset
--   (`recovery_sent_at`), whose template carries a sign-in code (Email
--   Decision 12). `greatest` ignores nulls; with neither set, nothing is sent
--   and the account is left alone.
-- * Email is its only sign-in method: it has an `email` identity and no other.
--   So never a GitHub account, and never an account with no identities at all,
--   which nothing in this flow creates and this job has no business guessing
--   about.
--
-- The job runs once a day, so an account goes between one and two days after
-- its last code, which is what the privacy notice says (Email FR-14).
--
-- Deleting the user cascades to its identities, sessions and one-time tokens.
-- Its `auth.flow_state` rows, which have no foreign key to it, go by
-- `delete-expired-auth-records` within a day. postgres, which the job runs
-- as, holds DELETE on auth.users on the local stack and the hosted project.
--
-- A job of its own rather than a third statement in
-- `delete-expired-auth-records`: pg_cron runs a job's command as one
-- transaction, so an error here -- a table that one day refuses to let a user
-- go -- would roll back that job's deletes too, every night, and Privacy FR-7
-- depends on them. Ten minutes after it, so the two never contend.

select cron.schedule(
    'delete-abandoned-email-sign-ups',
    '27 3 * * *', -- daily, 03:27 UTC
    $$
        delete from auth.users u
         where u.email_confirmed_at is null
           and greatest(u.confirmation_sent_at, u.recovery_sent_at)
               < now() - interval '1 day'
           and exists (select 1 from auth.identities i
                        where i.user_id = u.id and i.provider = 'email')
           and not exists (select 1 from auth.identities i
                            where i.user_id = u.id and i.provider <> 'email');
    $$
);
