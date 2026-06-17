# RingMePlease — Project Guide

## What This Is

A fake incoming call PWA that lets users escape awkward conversations or boring meetings. Set a timer, arm it, and when it fires your phone rings like a real call. Free, secure, no app store needed — works directly from the browser saved to the home screen.

**Live domain:** ringmeplease.com

## App Architecture

Pure static files — no backend, no build step, no dependencies.

```
index.html          — marketing landing page (site root)
app/index.html      — 4-screen single-page app (setup → waiting → incoming call → active call)
app/app.js          — all logic: state, audio engine, wake lock, screen transitions, photo upload
app/style.css       — iOS-style dark UI
app/sw.js           — service worker for offline/PWA caching
app/manifest.json   — PWA manifest (scope + start_url: relative ./)
app/ringtone.mp3    — the fake ringtone
app/silence.mp3     — 2s silent audio loop (key iOS trick — see below)
app/icons/          — icon-192.png, icon-512.png
```

Served from AWS at `https://ringmeplease.com` — landing page at the root, PWA at
`/app/`. The manifest uses relative `scope`/`start_url` (`./`) so it works wherever
it's hosted.

## Key Technical Tricks

**iOS audio unlock:** iOS blocks audio until a user gesture. We loop `silence.mp3` on ARM (the button tap = user gesture) to keep the audio session alive. When the timer fires we swap src to `ringtone.mp3` — no new user gesture needed. Without this, the ringtone would silently fail.

**Wake Lock:** `navigator.wakeLock.request('screen')` keeps the screen on during the wait. Re-acquired on `visibilitychange` if lost. Gracefully degrades if unsupported.

**Auto-arm on open:** Once configured (`ec_configured` in localStorage), opening the app skips the setup screen and goes straight to the lock screen. First tap starts the countdown and unlocks audio simultaneously.

**?t= URL param:** Delay can be encoded in the URL (`?t=30` = 30 seconds). Useful for creating multiple home screen shortcuts with different delays.

**Photo compression:** Uploaded photos are compressed to max 300×300 JPEG at 0.75 quality via Canvas before storing in localStorage (avoids quota errors).

**In-app debug console:** Tap the "RingMePlease" title 5× to toggle a fullscreen log panel (useful when you can't attach devtools to a real phone).

## The 4 Screens

1. **Setup** — contact name, photo upload, delay (min+sec), ARM button
2. **Waiting** — fake iOS lock screen with live clock, countdown running in background
3. **Incoming Call** — iOS-style call UI, swipe up or tap Accept/Decline
4. **Active Call** — call timer, End button returns to setup

## Deployment

**Live on AWS (S3 + CloudFront) at https://ringmeplease.com.** Infra is defined with
CDK in `infra/` (see `infra/README.md`): a private S3 bucket (Origin Access Control),
a CloudFront distribution with a viewer function that rewrites directory URLs, an ACM
cert, and Route 53 alias records for the apex + `www`.

**Content deploys (CI/CD):** push to `main` (e.g. a merged PR) →
`.github/workflows/deploy-aws.yml` syncs `index.html` + `app/*` to S3 and invalidates
CloudFront. Auth is via **GitHub OIDC** — no long-lived AWS keys. The deploy role
(`ringmeplease-github-deploy`, created by the CDK stack) is scoped to *only* this
bucket + this distribution. Required repo **variables**: `AWS_DEPLOY_ROLE_ARN`,
`S3_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`.

**Infra changes:** edit `infra/lib/site-stack.ts`, then
`npx cdk deploy --profile ringmeplease-cdk-admin`. This needs the local admin profile,
whose IAM user (`ringmeplease-cdk-admin`) is scoped to only assume the CDK bootstrap
roles — the CI deploy role intentionally cannot modify infrastructure.

## Landing Page

`index.html` (site root) — the marketing landing page; the PWA app lives under `/app/`. Landing-page CTAs link to `./app/`.

Sections: hero (floating phone mockup) → value props (Free/Private/No App Store) → How It Works (3 steps) → 5 pixel art use-case cards (horizontal scroll) → install guide (iOS/Android CSS tab switcher, no JS) → Why section (6 features) → FAQ (6 SEO-rich Q&As) → footer CTA.

Pixel art scenes — inline SVG with `shape-rendering="crispEdges"`:
1. The Endless Meeting — office, whiteboard, three bored attendees (ZZZ + phone)
2. The Netflix Monologue — dark living room, Netflix N on TV, speech bubble
3. The Awkward Date — restaurant, candle, sweat drops
4. Happy Halloween — jack-o-lanterns, vampire talking, witch checking RingMePlease (green glow)
5. Family Dinner — chandelier, grandma interrogating, protagonist with phone under table

SEO targets: "fake call app", "fake incoming call iphone", "escape meeting", "no app store", "free fake call".

## Backlog

- Ringer chooser (pick from multiple ringtone options)
- Multiple home screen shortcut presets (quick delays: 1min, 5min, custom)
- Android-specific incoming call UI variant
- Vibration pattern alongside ringtone (`navigator.vibrate`)
- Custom caller photo from URL param (for shareable links)
- "Call script" suggestions shown after answering
- Dark/light mode for the landing page
