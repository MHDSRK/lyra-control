# Lyra Control production checklist

- [ ] Create Supabase project and run `supabase/schema.sql`.
- [ ] Create one owner account in Supabase Auth; disable public sign-ups.
- [ ] Set server-only service-role key; never use it in `NEXT_PUBLIC_*` variables.
- [ ] Add a long random webhook path secret and cron secret.
- [ ] Configure VAPID keys and test push from the iPhone Home Screen web app.
- [ ] Configure Resend verified sender and test fallback email.
- [ ] Deploy over HTTPS.
- [ ] Configure Sarvam webhook to `/api/webhooks/sarvam/<secret>`.
- [ ] Run a test call and verify one row is created (repeat webhook delivery to verify idempotency).
- [ ] Verify the caller number, timestamps, duration, transcript and summary fields against a real payload.
- [ ] Test urgent event push and email.
- [ ] Configure scheduled analytics backfill with `Authorization: Bearer <CRON_SECRET>`.
- [ ] Verify what Sarvam exposes for failed/unanswered inbound attempts in this workspace.
- [ ] Review retention and access policy for transcripts and caller numbers.
- [ ] Do not rely on email fallback for a host outage until an external uptime monitor is configured.
