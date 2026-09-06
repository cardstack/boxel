# Choreo 3D gallery and film delivery

The live gallery is part of the canonical test app at `/_widgets`. It arranges
45 real demo components in six architectural bays, with native-size expanded
cards and physical category signs. Far-away cards use pre-rendered desktop or
phone posters. Only the currently featured card runs; visited cards retain DOM
and state while parked. A paint-ready handoff covers the transition to live content.

The full tour narrates all 45 demos using separate local audio clips. The
50-second highlights cross five capability chapters with a continuous camera,
a shared animated cursor, and 23 scripted interactions, ending in Build Order.
Both tours start Mockup in 3D. Reduced-motion playback uses stationary views.

## Run and check

Use Node.js 22.16 or later for the delivery and inspection scripts.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --dir test-app exec vite --host 0.0.0.0 --port 4590
```

Open `http://localhost:4590/_widgets`. For a phone, use the development machine's
LAN address on the same network. Run these from the repository root with the
server running:

```sh
pnpm exec playwright install chromium webkit
node scripts/verify-widget-full-tour.mjs
node scripts/verify-widget-narration.mjs
node scripts/verify-widget-mockup-tour.mjs
node scripts/verify-widget-freeze.mjs
FREEZE_BROWSER=webkit node scripts/verify-widget-freeze.mjs
node scripts/verify-widget-room-architecture.mjs
node scripts/verify-widget-handoff.mjs
node scripts/verify-widget-quick-reduced.mjs
```

Browser scripts use installed Playwright browsers by default. `CHROME_PATH` and
`WEBKIT_PATH` optionally select a compatible local executable. Individual checks
accept URL overrides (`NARRATION_URL`, `MOCKUP_URL`, `FREEZE_URL`, `ROOM_URL`).

## Render the highlight MP4

Install FFmpeg with libx264 and run the dev server, then:

```sh
CAPTURE_URL=http://localhost:4590/_widgets node scripts/record-widget-highlights.mjs
```

The renderer produces a 1920×1080, 60 fps, 50-second H.264/AAC MP4 under
`videos/choreo-widget-room/renders/`, plus a capture audit and inspection frames.
It prewarms featured demos and uses a deterministic capture clock. Lower thirds
are composited as an overlay; narration is muxed from the local highlight track.
Review the capture audit for missed actions and inspect the film before delivery.
MP4s and generated output are excluded from Git; this PR delivers the source,
assets, and repeatable capture tooling, not a hosted video link.

## Source map

- `test-app/app/components/widget-room.gts`: room lifecycle and tour UI.
- `test-app/app/lib/widget-*`: geometry, camera, score, interaction, readiness,
  and narration coordination.
- `test-app/public/widget-previews/rendered-20260906`: 2× desktop/phone posters.
- `test-app/public/widget-tour`: narration, alignment, and scripts; no API key is needed.
- `scripts/capture-widget-previews-now.mjs`: recapture posters from actual cards.
- `scripts/package-widget-boxel.mjs`: standalone Boxel host packaging.

See [Boxel deployment](BOXEL-DEPLOYMENT.md), [room design](ROOM-DESIGN.md),
[highlight score](QUICK-TOUR.md), and [performance notes](PERFORMANCE.md).
The accompanying Sagrada changes refine model geometry, shader stability,
material grading, and typography; its procedural model is an interpretation,
not a surveyed reconstruction.

## Tour loading recovery

Narration uses explicit audio content negotiation and retries failed or stalled
loads with fresh URLs. If a clip remains unavailable after two retries, the
tour continues to the next clip; browser permission denial still requires a
visitor tap. Pausing cancels recovery so a user-paused tour stays paused.

Mockup loads its 3D model ahead of its stop, freezes its render loop until active,
and retries transient model failures. The guide owns screen clicks during tours;
the device score supplies camera motion. Visible-canvas checks cover a failed
model request and activation while the model is still loading.

```sh
TOUR_START=30 TOUR_END=33 FAIL_CLIP=fold STALL_CLIP=sheet node scripts/verify-widget-full-tour.mjs
MOCKUP_FAIL_MODEL=1 node scripts/verify-widget-mockup-tour.mjs
MOCKUP_WAIT_ACTIVE=1 node scripts/verify-widget-mockup-tour.mjs
```
