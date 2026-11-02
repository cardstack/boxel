---
name: live-public-sites
description: Building a live, crowd-facing public site on Boxel host mode, where many signed-out visitors watch one thing change and act on it at the same moment — a pub quiz, a ticket on-sale, a waiting-room queue, a live vote. Covers how changes reach visitors (the realm's event feed, ADR event-feed), why a room shares one address and runs into the anonymous rate limit, keeping hot state off the card everyone watches, server-stamped fairness (queue positions, lock times, admission windows), operation conflicts and the retries the app owes, stale visitor code and refresh requests, fixed pages instead of page-type searches, screens nobody touches (TV, projector, kiosk audio), and rehearsing with a probe before the event. Use when designing, building or debugging such a site, especially one that works for a single tester and stalls with a room. Triggers on `_live`, `anonymousRateLimit`, `preceding-operation-failed`, `boxel-refresh-requested`, "on-sale", "ticket sale", "queue", "waiting room", "live event", "stalls with a crowd".
---

# Live public sites

A site most people visit one at a time hides its costs. A live one, where a
room or a crowd watches the same card and acts within the same second, finds
every one of them at once. This skill is what a pub quiz (a TV, a
quizmaster's desk, a table of phones, all signed out but the desk) taught,
written for the next one: a ticket on-sale with a queue.

Cite rules as ADR event-feed §x.y (the realm's event feed) and ADR site-routing §x.y (site
addresses) rather than restating them. The `realm-policy-authoring` skill
covers opening operations to visitors who aren't signed in (`anonymous: true`)
and the realm's `anonymousRateLimit`; `card-operations-authoring` covers
declaring the operations.

## 1. What a crowd does that one tester doesn't

- **A room shares one address.** The venue's network, a household router, or
  a proxy in front of the realm (a Boxel Link tunnel) puts every visitor
  behind one IP. The anonymous rate limit counts per realm per address, 300
  requests a minute by default. Size `anonymousRateLimit` on the realm for the
  room, not the person. The quiz needed it raised far past the default.
- **Every change sends every screen back for the card.** The feed carries an
  invalidation, and each page re-reads the card it names. Ten screens and one
  write is ten reads; until ADR event-feed §1.4's exemption for revision reads lands
  (see `docs/adr/remediation/event-feed.md`), each one counts against the room's
  limit.
- **A refused lookup looks like a missing page.** A page-type path is resolved
  by a search run as the visitor. When the limit refuses it, the site serves
  its not-found card with a 404 (ADR site-routing §1.4 says it must not; the remediation
  lists it). Under load, a 404 on a page you know exists is a rate limit until
  proven otherwise.
- **An open page keeps the code it loaded.** The feed doesn't announce module
  changes yet (ADR event-feed §1.1 remediation), so a fix you push reaches signed-in
  pages and not the visitors' screens. After a code push, send a refresh
  request (§5).

## 2. Keep hot state small, and off the card everyone watches

- **Every write to a watched card is paid by every watcher.** One game card
  that every phone writes its answer into, and every phone watches, costs a
  read per phone per answer: fine for ten phones, ruinous for ten thousand
  buyers.
- **Split by who watches.** A small public _status_ card carries what the crowd
  watches: the phase, the number now being served, what's left. It is written
  by the operator or a job at a bounded rate (about once a second at most),
  never by each visitor. Each visitor's own state lives on their own card
  (their entry, their ticket), which only they watch.
- **One hot card is also a write queue.** Writes to one card serialize. A
  visitor's operations against the same card queue in the client, and when one
  fails or was computed on a version the realm has moved past, the ones queued
  behind it are dropped with `preceding-operation-failed` (status 409). The app
  owes the retry: retry only that code and version conflicts, a few times, with
  a random delay. Never retry a refusal the realm meant, such as an assert.
- **Watch for request bursts.** While one phone's answer kept failing, that
  phone re-read the game card about 480 times in a fraction of a second. The
  cause isn't pinned down; the likely one is the client re-reading on each
  failure. Count requests per screen while you rehearse (§7).

## 3. Fairness comes from the server

- **Stamp every time and position in the operation's `input`**, which runs on
  the realm and overrides whatever the caller sent. A lock time is stamped the
  same way when the question opens, and the answer operation asserts
  `params("at") <= .lockAt`. Never trust a client's clock.

  ```ts
  input: bxl`. + { at: TEXT(NOW(); "yyyy-mm-dd") & "T" & TEXT(NOW(); "hh:mm:ss") & "Z" }`,
  ```

- **A queue position is a created card, not a shared counter.** An entrant's
  `create` operation (granted with `anonymous: true`, the realm minting the
  id) stamps the time and a random tiebreak; order is (time, tiebreak). A
  counter card every entrant increments is a hot card (§2).
- **Admit in batches, with a server-stamped deadline.** The operator's (or a
  job's) operation flips the next batch of entries to admitted and stamps
  `admittedUntil`. The purchase operation asserts that the caller's entry is
  admitted and `NOW()` is before the deadline, and takes stock in the same
  transform.
- **Spread stock that everyone buys from** over several cards (one per
  section or price band) so purchases don't all serialize on one.
- **BXL traps the quiz hit:** `del(.list[] | select(...))` fails with
  "Mutation target matched no locations" when nothing matches, so rebuild the
  list instead: `.list = [.list[] | select(.team != params("team") or .n !=
params("n"))] + [...]`. `NOW()` is a spreadsheet serial: format it with
  `TEXT`. A transform that lets a caller replace their own earlier entry (a
  changed answer) does it this way, not with an assert that refuses a second
  one.

## 4. Read directly, and route without searching

- **Screens read the one card they show, directly.** Don't drive live state
  through `getCards` or a query on a public page. The feed tells the page when
  to re-read; a slow backstop read (every ten seconds) covers a dropped feed
  and should replace what's shown only when it differs.
- **Serve the event page as a fixed page.** A host routing rule that maps
  `/play/LAMB` straight to the game card costs one card read per load; a
  page-type path costs a search as the visitor, from the room's budget
  (ADR site-routing §2). Keep page types for the long tail, fixed pages for the hot
  addresses.

## 5. Changing code during an event

- A realm writer can ask every page following a realm's feed to reload:
  `POST {realm}/_live/refresh`, at most once a minute (ADR event-feed §1.8).
- A page is first offered the request as a cancelable `boxel-refresh-requested`
  window event whose `detail` has `realm` and `reload()`. An app that calls
  `preventDefault()` keeps the page as it is, tells its visitors an update is
  ready, and calls `reload()` at a safe moment (the quiz waits for the reveal,
  the lobby or the podium; an on-sale should never reload a buyer mid-checkout).
  A page whose app doesn't take it does a hard reload within a few seconds.
- Keep page-wide resources that must survive a module reload (an unlocked audio
  element, an `AudioContext`) on `globalThis` as **data only**. Behaviour stays
  in the module, so a rebuilt module runs its new code over them. Storing a
  whole object with methods pins the page to the code that created it.

## 6. Screens nobody touches

- **Browsers start no sound without a gesture.** A projected TV is never
  tapped. Options, most reliable first:
  - play the audio from the operator's device, where every advance is a click
    or a key press;
  - run the screen in Chrome with
    `--autoplay-policy=no-user-gesture-required` (a kiosk profile);
  - in Safari, set the site's Auto-Play to Allow All Auto-Play (Safari menu,
    Settings for This Website);
  - one click on the screen's machine, then reuse that one unlocked audio
    element for every clip.
- **Never fall back silently.** Safari can accept `play()` and stay silent.
  Treat a clip as played only once it is actually advancing (`timeupdate` with
  `currentTime > 0` within a second or two), and put the reason on screen when
  it isn't. A quiet fallback to another voice hid a real bug for an hour.

## 7. Rehearse with a probe

- Give the event a twin: a throwaway game card and desk (`QuizNight/probe`,
  `HostDesk/probe`) on the same site and fixed-page route. Run the whole flow
  there, never on the live card.
- Drive it from code (click the desk's buttons through script) so the steps
  beat the timers, and check the realm's copy of the card after each step, not
  only what the screen shows.
- Count requests per screen per change from the browser's network log or
  resource timings (raise the buffer with
  `performance.setResourceTimingBufferSize`). Look for bursts and for 429s.
- Rehearse with as many screens behind one address as the venue will have.

## 8. A ticket on-sale, put together

1. A waiting-room page served as a fixed page, reading a public status card:
   sale phase, the number now admitted, stock per band.
2. A visitor joins by an anonymous `create` of their entry card, stamped with
   time and tiebreak by `input`; they watch only their own entry and the
   status card.
3. A job or the operator admits the next batch every few seconds with a
   transform that stamps each entry's `admittedUntil`, and updates the status
   card once per batch.
4. An admitted visitor buys with a named operation that asserts admission and
   the deadline and decrements stock on the band's card in the same transform.
5. Behind a CDN, the feed's cacheable poll (ADR event-feed §1.3) and revision reads
   (§1.4) carry the crowd. Gaps that still matter at that scale are listed in
   `docs/adr/remediation/event-feed.md`: one sequence per process across replicas,
   revision reads counted against the limit, and modules not announced.
