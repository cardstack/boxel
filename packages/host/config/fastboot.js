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
        Request: globalThis.Request,
        fetch: globalThis.fetch,
        btoa,
      });
    },
  };
};
