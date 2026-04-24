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
