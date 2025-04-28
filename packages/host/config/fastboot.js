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
        // @ts-expect-error Request experimental until Node 21
        Request: globalThis.Request,
        // @ts-expect-error fetch experimental until Node 21
        fetch: globalThis.fetch,
        btoa,
      });
    },
  };
};
