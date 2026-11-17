# Push notifications

Yorki can alert people on their phone or computer **even when the app is closed** — the same
things the bell shows: someone **@mentions** you, a task is **assigned** to you, someone
**comments** on a card you're on, or a card you're on is **completed**.

## For people using it

1. Open Yorki → your photo (menu) → **Notification settings**
   (or the bell → *Get alerts when Yorki is closed*).
2. Tap **Turn on alerts on this device** and allow notifications when the browser asks.
3. Tap **Send me a test** — it should appear within a few seconds.

| Device | What you need |
|---|---|
| **Android** (Chrome, Edge, Samsung) | Just do the steps above. |
| **Windows / Mac / Linux** (Chrome, Edge, Firefox) | Just do the steps above. |
| **iPhone / iPad** (iOS 16.4 or newer) | **Add Yorki to the Home Screen first** (Share → Add to Home Screen), open it from that icon, then do the steps above. Safari tabs can't receive push on iPhone — that's Apple's rule. |

On the same page you choose **what** alerts you, and whether the lock screen shows names and task
titles (turn this off for privacy: the alert then only says "You have a new notification").
Every device you've turned on is listed and can be removed.

- Alerts are **per device**: turn them on on your phone *and* your laptop if you want both.
- If you're **looking at Yorki** when something arrives, you won't get a banner too — the bell already
  tells you. (iPhone always shows one: Apple requires it.)
- Tapping an alert opens that card. Several alerts about one card replace each other instead of piling up.
- The little number on the app icon is your unread count (Android, desktop, installed iPhone apps).
- **Signing out turns alerts off on that device**, so the next person who uses a shared phone never
  receives yours.
- Blocked by mistake? Allow notifications in the browser's site settings (lock icon by the address),
  or on iPhone: Settings → Notifications → Yorki. The settings page explains this when it detects it.

## How it works (for the person running the server)

```
someone @mentions Ana ─▶ Yorki saves the bell notification ─▶ also posts an encrypted message to
each of Ana's devices' addresses at Google / Apple / Mozilla / Microsoft's push service ─▶ the
service wakes the device ─▶ Yorki's service worker (public/sw.js) shows it.
```

- **Nothing to configure.** The signing key pair (VAPID) is created the first time it's needed and
  stored in the database (`settings` row `push_vapid`), so it's included in backups and restores.
  To keep it in `.env` instead: `node scripts/generate-vapid-keys.cjs` and see `env.production.example`.
  **Changing the key later makes every device turn notifications on again.**
- **Contact address** the push services can use: `VAPID_SUBJECT`, else `APP_URL` if it is https,
  else the notification email in Admin → Email. Setting `APP_URL` correctly is enough.
- **HTTPS is required** (browsers refuse push on plain http).
- **Privacy:** messages are end-to-end encrypted to the device (RFC 8291). Google/Apple/Mozilla relay
  them but can't read them; they do see that *a* message was sent to a device and when. Message text
  is built from the same data as the bell (people with no access to a card are never notified about it;
  internal admin-only notes only alert admins).
- **Safety:** the server only ever posts to the real push services (an allow-list of hosts). A signed-in
  user can't register an internal address to make the server call it. All changes require a same-site
  request with a JSON body. A new service can be allowed with `PUSH_EXTRA_HOSTS`.
- **Housekeeping:** devices that unsubscribed (HTTP 404/410) are forgotten automatically; ones that keep
  failing are dropped after 10 tries in a row; each person keeps at most 10 devices. Deactivated users
  receive nothing.
- **Database:** `push_subscriptions` (one row per device) and `push_prefs` (per person). No message text is stored.

## Testing

| Test | What it proves |
|---|---|
| `tests/push.test.cjs` | address allow-list (internal / look-alike hosts refused), message wording and privacy, preferences, device limits, retries and cleanup — and **end to end against a local fake push service: the message is decrypted with an independent implementation of the encryption standard, only the right device's key can read it, and the request signature verifies with our public key** |
| `tests/e2e/push.js` | the API's security rules in a real browser; the **real service worker** receiving a pushed message (shown / replaced / suppressed when the app is in front / tap opens the right card / hostile or broken data handled); the settings page in each situation |

**Not covered by automatic tests:** delivery through the real Google/Apple/Mozilla services to a real
phone (they can't be reached from the test environment). Check once by hand after deploying:

1. On a phone: install Yorki (iPhone: Add to Home Screen), sign in, open **Notification settings**, turn alerts on.
2. Tap **Send me a test** → a notification should arrive. Lock the screen and try again.
3. From another account, @mention that person → alert arrives; tap it → the card opens.
4. Sign out on the phone → the device disappears from the list (and no more alerts arrive).

If the test doesn't arrive: the device list shows "having trouble receiving"; make sure the server can
reach the internet over HTTPS (it posts to `fcm.googleapis.com`, `web.push.apple.com`,
`updates.push.services.mozilla.com`, `*.notify.windows.com`) and that `APP_URL` is your real https address.

## Not included (yet)

- **Reminders** for due and overdue cards (needs a scheduler that runs while nobody is using the app).
- **Quiet hours** / do-not-disturb schedules (your phone's own Do Not Disturb works).
- Alerts for the other things the bell doesn't cover.
- A tap in the first instant of the page loading may not move an already-open window to the card
  (a closed app opens straight to it).
