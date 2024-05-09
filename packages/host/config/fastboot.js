let { JSDOM } = require('jsdom');

function btoa(str) {
  let buffer;
  if (str instanceof Buffer) {
    buffer = str;
  } else {
    buffer = Buffer.from(str.toString(), 'binary');
  }
  return buffer.toString('base64');
}

module.exports = function () {
  let window = new JSDOM('', { pretendToBeVisual: true }).window;
  window.devicePixelRatio = 1;
  window.screen = {};

  return {
    buildSandboxGlobals(defaultGlobals) {
      return Object.assign({}, defaultGlobals, {
        URL: globalThis.URL,
        Request: globalThis.Request,
        fetch: globalThis.fetch,
        atob,
        btoa,
        window,
        document: window.document,
        navigator: window.navigator,
      });
    },
  };
};
