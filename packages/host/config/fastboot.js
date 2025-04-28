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
  return {
    buildSandboxGlobals(defaultGlobals) {
      return Object.assign({}, defaultGlobals, {
        URL: globalThis.URL,
        // eslint-disable-next-line n/no-unsupported-features/node-builtins
        Request: globalThis.Request,
        // eslint-disable-next-line n/no-unsupported-features/node-builtins
        fetch: globalThis.fetch,
        btoa,
      });
    },
  };
};
