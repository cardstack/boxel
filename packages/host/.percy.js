module.exports = {
  version: 2,
  snapshot: {
    widths: [1280],
    percyCSS: `
      [data-test-percy-hide], .monaco-editor .decorationsOverviewRuler {
        visibility: hidden;
      }
    `,
  },
};
