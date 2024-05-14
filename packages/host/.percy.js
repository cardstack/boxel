module.exports = {
  version: 2,
  snapshot: {
    widths: [1280],
    percyCSS: `
      [data-test-percy-hide] {
        visibility: hidden;
      }

      #ember1420 {display: none !important;}
    `,
  },
};
