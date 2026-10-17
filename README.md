# Lyra Control

A mobile-first Next.js dashboard for monitoring calls handled by Sarvam Voice Agents. Includes a private sign-in, call history, transcript viewer, iPhone Home Screen web-push support, important-event email alerts, a Sarvam inbound-call webhook, and an analytics backfill endpoint.

> **Integration starter, not yet connected to your live Sarvam account.** Real data and notifications require the environment variables and setup below. No live agent settings or Jio forwarding settings are changed by this app.

## Stack

- Next.js App Router + TypeScript
- Supabase Auth + Postgres
- Sarvam Voice Agent webhook and Analytics API (`X-API-Key`)
- Web Push with VAPID (supported by iOS/iPadOS 16.4+ Home Screen web apps)
- Resend email for important alerts

## 1. Create Supabase project

1. Create a Supabase project.
2. In SQL Editor, run `supabase/schema.sql`.
3. In Authentication, enable email/password sign-in and create your owner user. Disable public sign-up after creating your account.
4. Copy Project URL, anon key, and service-role key to `.env.local`. **Never expose the service-role key to the browser.**

## 2. Configure environment

```bash
cp .env.example .env.local
```

Fill in all values. Generate push keys:

```bash
npx web-push generate-vapid-keys
```

Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`. Configure a verified sender/domain in Resend and set the three email variables. Set a long random `SARVAM_WEBHOOK_SECRET` and a separate `CRON_SECRET`.

## 3. Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000/login`. Push notifications require HTTPS in production (localhost is allowed for development). Create the owner in Supabase Auth first.

## 4. Configure Sarvam inbound webhook

In the Sarvam Voice Agent deployment's `webhook_config`, set the URL to:

`https://YOUR_DEPLOYMENT_DOMAIN/api/webhooks/sarvam/YOUR_SARVAM_WEBHOOK_SECRET`

The secret is in the URL because the inbound webhook config is documented as a URL-only setting. Keep it private, use a long random value, and rotate it if exposed. The handler validates `interaction_id` and uses an upsert keyed by that ID, so repeated deliveries do not create duplicate call rows. The webhook payload contains caller number, timestamps, duration, agent variables and transcript when supplied.

**Security note:** Sarvam's documented inbound payload page does not specify a signed webhook header. The private path secret is a compensating control, not cryptographic request signing. For a public deployment, use a long random secret, avoid logging the full URL, rate-limit the endpoint at the hosting layer, and monitor unusual traffic.

## 5. Analytics backfill

`POST /api/analytics/sync` reads the previous 7 days from Sarvam's Analytics API and upserts interactions. Call it from a scheduled job (for example, Vercel Cron) using `Authorization: Bearer YOUR_CRON_SECRET`. This is a recovery/backfill mechanism for missed webhook deliveries; it is not an inbound-call realtime trigger.

Sarvam endpoint used:

`https://apps.sarvam.ai/api/analytics/v1/{org_id}/{workspace_id}/{app_id}/interactions`

Required header: `X-API-Key`. Validate the response schema against your Sarvam account before relying on sync, because the available fields vary by API response version and configuration.

## 6. Enable iPhone push

1. Deploy to an HTTPS domain.
2. On iPhone, open the site in Safari → Share → Add to Home Screen → turn on **Open as Web App** → Add.
3. Launch Lyra Control from its Home Screen icon and sign in.
4. Tap **Enable push** and allow notifications.
5. Check iPhone Settings → Notifications → Lyra Control, and configure Focus notification permissions as desired.

iOS/iPadOS 16.4+ supports Web Push for Home Screen web apps. The permission prompt must be initiated by a user gesture, which the Enable push button does.

## 7. Email fallback behaviour

The webhook sends a push for each completed inbound interaction. It emails the owner when an interaction is flagged urgent/failed, and also attempts an email if webhook processing throws. For webhook failures caused by the host being down or the request never reaching the app, use hosting logs and the analytics backfill/monitoring; the app cannot email about a request it never receives. Tune the `urgent` mapping to the actual output variables configured on Lyra, ideally a dedicated boolean `flag_urgent` and a stable `call_summary`/`call_outcome`.

## 8. Deployment

Deploy this project to Vercel or another Node-compatible HTTPS host. Add all `.env.example` variables in the hosting dashboard. Apply Supabase SQL before the first live webhook. Configure the Sarvam webhook URL only after the deployment responds correctly. Test with a non-sensitive test call before using it for real personal calls.

## Important limitations

- This app monitors calls after Sarvam sends the end-of-call webhook; it is not a live call listening console.
- Recording playback is proxied through the owner-authenticated `/api/calls/recording` route. It retrieves WAV audio from Sarvam using the server-side `SARVAM_API_KEY`, `SARVAM_ORG_ID`, `SARVAM_WORKSPACE_ID`, and `SARVAM_APP_ID`; the API key is never sent to the browser. Playback is fetched on demand and is not stored as a public recording URL in Lyra.
- Failure events for calls that never connect may not appear in the inbound end-of-call webhook. The analytics sync is included as a backfill, but you should verify the exact attempts endpoint and response schema for your Sarvam workspace before relying on it for failed-call alerts.
- iPhone web push requires adding the site to the Home Screen on iOS/iPadOS 16.4 or later, HTTPS, and user permission. Email fallback requires Resend and a verified sender domain.
- Authentication is private by default: the UI requires Supabase sign-in, and call tables have no direct browser role grants. Keep the service role and provider keys server-side.


## Inbox, message capture, notifications and privacy controls

1. Apply `supabase/migrations/20261017_lyra_inbox_privacy.sql` to an existing database. For a fresh database, run `supabase/schema.sql`, which includes the same additions.
2. Set `OWNER_USER_ID` to the exact Supabase Auth user UUID for the authorized owner, or set `OWNER_EMAIL` to the exact owner email. At least one must be configured. Server-side call, push, settings and delete routes fail closed if the allowlist is missing or does not match.
3. Configure Lyra/Sarvam output variables for structured message extraction when available: `message_for`, `message_content`, `message_urgency`, and `message_deadline`. The dashboard does not invent a message when these fields are absent. `message_saved` means the structured message was persisted in Lyra's database.
4. Sarvam’s documented inbound webhook payload does not include a recording URL. Lyra therefore loads recordings on demand from Sarvam’s Analytics API through an owner-authenticated server proxy, using the interaction ID and server-side Sarvam credentials. The API key is never exposed to the browser; if Sarvam returns no recording or credentials are invalid, playback reports an error.
5. Push and email statuses mean the provider accepted a request; they do not mean the phone displayed it or a person read it. Routine push alerts are off by default and can be enabled in Settings. Urgent, structured-message and technical-failure push alerts remain enabled when push is configured. Important failures also attempt email fallback.
6. The retention control defaults to `Never auto-delete`. Select 30, 90, 180 or 365 days to enable scheduled deletion of the Lyra database copy. The retention job deletes the call row (including stored transcript and message fields) and associated Lyra notification records. It does not delete the original Sarvam recording or any data retained by Sarvam.
7. Confirm applicable recording-consent and privacy requirements, lawful basis, and the actual data regions/retention settings for Sarvam and Supabase. This application does not alter provider-side retention or consent configuration.

The inbox status is one of Needs attention, Message captured, Follow-up needed, or Reviewed. New calls default to Needs attention until manually reviewed. The analytics backfill preserves existing manual inbox status and richer webhook fields when the provider response omits them.
