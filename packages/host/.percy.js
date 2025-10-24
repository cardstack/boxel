module.exports = {
  version: 2,
  snapshot: {
    widths: [1280],
    percyCSS: `
      [data-test-percy-hide],
      .monaco-editor .decorationsOverviewRuler,
      .monaco-editor .margin-view-overlays {
        visibility: hidden;
      }
      .actions-overlay.selected {
        box-shadow: none !important;
      }
    `,
  },
};
