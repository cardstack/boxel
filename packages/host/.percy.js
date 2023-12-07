module.exports = {
  version: 2,
  snapshot: {
    widths: [1280],
    percyCSS: `
      .monaco-container[data-test-editor] {
        display: none;
      }

      [data-test-definition-info-test], [data-test-last-modified] {
        visibility: hidden;
      }
    `,
  },
};
