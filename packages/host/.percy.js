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
     * Realm fixtures declare background and icon images on these hosts. Left
     * unlisted, Percy treats each as an un-capturable remote resource: it
     * fetches the asset, spends a round trip on `percy.io/domain-validator-
     * worker/validate` deciding whether it may keep it, then discards it and
     * lets the renderer fetch the URL live instead. That is paid per snapshot
     * — `disable-cache` below means the discovery browser never reuses an
     * earlier fetch — and it is not cheap: one run spent 16.9s over 70 such
     * fetches, with single assets costing 2-5s each. The workspace chooser
     * renders a tile per workspace, so it pays that several times over and
     * pushed past the upload budget in `tests/helpers/percy-snapshot.ts`,
     * losing the snapshot entirely.
     *
     * Listing them here lets Percy capture the assets as ordinary snapshot
     * resources, deduplicated by content hash across the build, so the cost
     * is paid once rather than per snapshot. It also removes a live
     * third-party fetch from render time, which is the same determinism
     * argument the font hostnames above are blocked for — the difference is
     * that these images are load-bearing for what the snapshot looks like,
     * so they have to be captured rather than dropped.
     */
    'allowed-hostnames': [
      'i.postimg.cc',
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
