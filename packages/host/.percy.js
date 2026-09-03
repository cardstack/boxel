module.exports = {
  version: 2,
  /*
   * Card fixtures can declare fonts served by Google Fonts. Letting Percy's
   * asset discovery fetch those per build makes snapshot rendering depend on
   * a live third-party response — which woff2 subsets get captured can vary
   * between builds of identical code, flipping text between the themed font
   * and its fallback. Blocking the hostnames means those fonts are never
   * captured, so every build deterministically renders the fixture's
   * fallback stack (fonts Percy's renderer has locally, e.g. Georgia).
   */
  discovery: {
    'disallowed-hostnames': ['fonts.googleapis.com', 'fonts.gstatic.com'],
    /*
     * Realm fixtures declare background and icon images on these hosts.
     *
     * What this list decides is whether Percy keeps an asset it fetches. A
     * listed host's assets are captured as ordinary snapshot resources,
     * deduplicated by content hash across the build and served from that
     * capture at render time. An unlisted host's are fetched, put through a
     * round trip on `percy.io/domain-validator-worker/validate`, and then
     * discarded, leaving the renderer to fetch the URL live from a host that
     * is not ours. That is the same determinism argument the font hostnames
     * above are blocked for; the difference is that these images are
     * load-bearing for what the snapshot looks like, so they have to be
     * captured rather than dropped.
     *
     * What the list does NOT decide is what the page load waits for. The
     * discovery browser waits for every image the page references, listed or
     * not, and `disable-cache` below means it refetches them per snapshot. So
     * a slow host costs latency on every snapshot however it is listed, and
     * when it stalls the navigation never fires `load`, Percy retries it
     * three times, and the snapshot is dropped — silently, because the test
     * that asked for it still passes.
     *
     * Listing a host therefore buys capture and render-time determinism, not
     * immunity from a slow one. Both hosts below are ours, which is the
     * property that earns a place here: when one is slow, it is ours to fix.
     * A fixture that needs an image should not add a third-party host — put
     * the image in `public/test-fixtures/realm-images/`, where there is
     * nothing to fetch and so nothing to wait for.
     */
    'allowed-hostnames': [
      'boxel-images.boxel.ai',
      'boxel-assets-store.s3.us-east-1.amazonaws.com',
    ],
    /*
     * The discovery browser is reused across a shard's snapshots, and
     * Chrome's own HTTP cache satisfies repeat font requests without them
     * ever reaching Percy's proxy — so only the shard's first snapshot got
     * the woff2s attached, and every later snapshot rendered fallback text.
     * Disabling the browser cache makes every request visible to the proxy,
     * so each snapshot carries its full resource set. Percy's proxy-side
     * response cache still prevents refetching from the test server.
     */
    'disable-cache': true,
    /*
     * Percy opens this many asset-discovery browsers at once. Its default is
     * 10, which on a 4-core runner already shared with the test browser, the
     * realm server, its workers, the prerenderer and postgres is a 2.5x
     * oversubscription — and Percy notices only after the fact.
     *
     * Its adjustment loop halves concurrency whenever CPU or memory passes
     * 80%, and adds 2 whenever both drop under 50%, bounded by the value set
     * here. Starting at 10 that produces a cycle rather than a settling
     * point: one run logged 62 downscales stepping 10 -> 5 -> 2 -> 1, then
     * climbing back to repeat it, with CPU pinned at 100%. Each pass churns
     * browser pages, which costs the CPU the loop is reacting to.
     *
     * The cost lands on snapshots. Discovery starved of CPU queues, and the
     * upload budget in tests/helpers/percy-snapshot.ts expires, so the
     * snapshot is abandoned and never reaches the CLI. That is silent — the
     * shard stays green — and the tally in ci-host.yaml is what surfaces it.
     * Seven builds lost 22 snapshots between them over three days, including
     * two consecutive `main` builds that the loss gate then rejected rather
     * than let become baselines.
     *
     * A ceiling of 2 leaves the loop room to drop to 1 under pressure and
     * come back, without the climb to 10 that starts the cycle again.
     *
     * This is a hypothesis about a bottleneck, not a proven fix: the claim is
     * that steady low concurrency beats oversubscription plus thrash when CPU
     * is the constraint. The measurement is the same tally — `lost` in the
     * finalize job's totals should stay at 0. If loss continues, the next
     * things to try are the shard count and the 25s budget itself.
     */
    concurrency: 2,
  },
  snapshot: {
    widths: [1280],
    percyCSS: `
      [data-test-percy-hide],
      .monaco-editor .decorationsOverviewRuler,
      .monaco-editor .margin-view-overlays,
      .monaco-editor .view-overlays .core-guide,
      .monaco-editor .view-overlays .core-guide-indent,
      .monaco-editor .view-overlays .bracket-indent-guide,
      .monaco-editor .cursors-layer {
        visibility: hidden;
      }
      .actions-overlay.selected {
        box-shadow: none !important;
      }
      /*
       * Monaco paints token colours in batches as the grammar registers,
       * the worker computes bracket-pair colorisation, and the language
       * service publishes follow-up updates. Percy can capture the
       * editor at any of those intermediate states — fully plain,
       * partially coloured, or fully coloured — even when the test
       * waiter has waited for layout, diff, and indent-guide readiness.
       * Neutralise every Monaco token span to the editor's default
       * foreground colour so the capture is deterministic regardless
       * of which tokenisation pass has painted. (This trades syntax-
       * highlighting verification for stability; Percy's job is layout
       * regressions, not grammar correctness.)
       */
      .monaco-editor .view-lines,
      .monaco-editor .view-lines * {
        color: inherit !important;
      }
      /*
       * Land every CSS animation and transition on its final state so Percy
       * captures aren't racing the animation clock. Negative delay + 1ms
       * duration fast-forwards each animation past its last keyframe before
       * the snapshot is taken, which removes the "sending message muted"
       * and "retry button" opacity/colour mid-transition false positives.
       */
      *, *::before, *::after {
        animation-delay: -1ms !important;
        animation-duration: 1ms !important;
        animation-iteration-count: 1 !important;
        transition-delay: -1ms !important;
        transition-duration: 1ms !important;
      }
    `,
  },
};
