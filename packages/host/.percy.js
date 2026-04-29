module.exports = {
  version: 2,
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
