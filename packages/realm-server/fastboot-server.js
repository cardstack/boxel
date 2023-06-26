const FastBootAppServer = require('fastboot-app-server');

let server = new FastBootAppServer({
  distPath: `${__dirname}/../host/dist`,
  gzip: true, // Optional - Enables gzip compression.
  host: '0.0.0.0', // Optional - Sets the host the server listens on.
  port: process.env.PORT, // Optional - Sets the port the server listens on (defaults to the PORT env var or 3000).
  workerCount: 1,
  buildSandboxGlobals(defaultGlobals) {
    // Optional - Make values available to the Ember app running in the FastBoot server, e.g. "MY_GLOBAL" will be available as "GLOBAL_VALUE"
    return Object.assign({}, defaultGlobals, {
      URL: globalThis.URL,
      Request: globalThis.Request,
      Response: globalThis.Response,
      btoa,
      fetch: globalThis.fetch,
    });
  },
  log: true, // Optional - Specifies whether the server should use its default request logging. Useful for turning off default logging when providing custom logging middlewares
  chunkedResponse: true, // Optional - Opt-in to chunked transfer encoding, transferring the head, body and potential shoeboxes in separate chunks. Chunked transfer encoding should have a positive effect in particular when the app transfers a lot of data in the shoebox.
});

server.start();
