# ADR 0020 — Customer messaging with recorded consent

- **Status:** Accepted (2026-10-18)

## Context

Shops want to tell regular customers about new stock and offers, by SMS (most common in Sri
Lanka) or e-mail. Marketing messages need the customer's agreement, and the shop must be able
to show when and how it was given or withdrawn. Sri Lanka's Personal Data Protection Act also
expects this record and a simple way to object to direct marketing. SMS costs money per
message, and the platform pays the gateway.

## Decision

### Consent

- `customers.marketing_consent_at` stays the current state.
- Every change is appended to `consent_events`, which records:
  - granted or withdrawn;
  - source: `STAFF` or `UNSUBSCRIBE_LINK`;
  - an optional note on how it was asked (for example "Asked at the till");
  - who recorded it, and when.
- The application role may only read and insert there (no update or delete), so the
  history is evidence.
- Consents given before this slice were back-filled with their original date.
- The customer page shows the current state and the history. The customer form asks "How
  was this agreed?" whenever the consent box changes.

### Opt-out link

- Every customer has a random 12-character `unsubscribe_code` (about 70 bits), unique
  across businesses.
- Every message ends with `WEB_APP_URL/u/<code>`: e-mails also carry it as
  `List-Unsubscribe`, and SMS end with `Stop: <link>`.
- The page needs no sign-in, and opening it changes nothing, because mail scanners open
  links. The customer confirms with a button. That:
  - withdraws consent (source `UNSUBSCRIBE_LINK`, no actor);
  - skips that customer's queued messages;
  - is audited.
- Repeating it changes nothing. Unknown codes get 404, and the endpoints use the strict
  rate limit.

### Campaigns and sending

- People with the new `customers.message` permission (owners and managers) send a
  message by e-mail or SMS. Recipients are active customers who agreed and have an
  address: an e-mail address, or a Sri Lankan mobile number for SMS.
- `{name}` is replaced by the first name.
- **Creating** a campaign queues one delivery per recipient in the same transaction. It is
  idempotent on a client-chosen id and audited with counts only.
- **Sending:** `MessagingSweep` (every `MESSAGING_SWEEP_SECONDS`) sends queued deliveries
  one per transaction, locked with `FOR UPDATE SKIP LOCKED`, so several API instances
  never send the same message twice.
- **Before sending,** it re-checks consent, customer status, the address and the
  `messaging` flag; anything that no longer holds is `SKIPPED`.
- **Failures:** temporary ones (network, gateway 5xx/429, SMTP) are retried on later runs
  up to three attempts; refusals fail at once. Errors stored are short reasons, never
  credentials or message content.
- A campaign is `DONE` when nothing is left queued. The page shows sent, waiting, failed
  and skipped counts.

### Channels

- **E-mail** uses the existing mailer (SMTP).
- **SMS** uses [Notify.lk](https://developer.notify.lk/api-endpoints/):
  - a POST form with `user_id`, `api_key` and `sender_id`, so credentials never sit in
    URLs or logs;
  - `to` as `94XXXXXXXXX`, and `type=unicode` for Sinhala and Tamil.
- Without all three `NOTIFYLK_*` settings, SMS is shown as unavailable and refused with
  `503 MESSAGING_UNAVAILABLE`. Nothing pretends to send.

### SMS length and cost

- **Length:** the composer counts GSM-7 (160/153 per part) or Unicode (70/67) parts,
  including the opt-out line. The server refuses texts that cannot fit the gateway's
  621-character limit with the link and a 20-character name.
- **Monthly allowance:** each plan includes SMS per calendar month
  (`plans.sms_per_month`: Starter 200, Growth 1,000, Business 5,000). Queued and sent SMS
  since the start of the month in the business's time zone count against it.
- **Locking:** creating an SMS campaign locks the subscription row, so two campaigns cannot
  both use the last messages. A campaign that does not fit is refused with
  `PLAN_LIMIT_REACHED` and the number left.
- **Flag:** platform staff can switch messaging off per business (`messaging`, default on).

## Consequences

- **Delivery reports** (from the handset or the e-mail inbox) are not collected: "sent"
  means the gateway or SMTP server accepted the message.
- **Changing a plan's SMS allowance** needs a migration. The platform console's plan editor
  does not show it yet.
- **Not included:** audience filters (for example by branch or last purchase), scheduled
  sending and per-channel consent. Consent covers marketing by any channel the customer
  gave contact details for.
