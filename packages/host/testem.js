'use strict';

if (typeof module !== 'undefined') {
  const MultiReporter = require('testem-multi-reporter');
  const TapReporter = require('testem/lib/reporters/tap_reporter');
  const XunitReporter = require('testem/lib/reporters/xunit_reporter');
  const fs = require('fs');
  const path = require('path');

  const config = {
    test_page: 'tests/index.html?hidepassed',
    disable_watching: true,
    browser_disconnect_timeout: 60,
    // socket.io pingTimeout. testem otherwise derives this from
    // browser_disconnect_timeout (60s), which is too tight for this suite: on
    // a CI runner the whole service stack and Chrome contend for the runner's
    // vCPUs, so the browser can be too starved to answer a socket.io ping
    // within 60s even while every test is still passing — the control socket
    // then drops and testem reports the browser dead mid-run.
    //
    // This is also the only bound testem puts on a browser whose main thread
    // hangs: it has no per-test or no-activity timeout. A hung page drops the
    // socket with `ping timeout` after up to the 25s ping interval plus this
    // timeout, and testem then waits browser_disconnect_timeout before
    // reporting `Browser timeout exceeded` — up to about six and a half
    // minutes in all. The disconnect reason in the debug log below names
    // which case a failure was.
    socket_heartbeat_timeout: 300,
    launch_in_ci: ['Chrome'],
    launch_in_dev: ['Chrome'],
    browser_start_timeout: 240,
    browser_args: {
      Chrome: {
        ci: [
          // --no-sandbox is needed when running Chrome inside a container
          process.env.CI ? '--no-sandbox' : null,
          '--headless',
          '--disable-dbus',
          '--disable-dev-shm-usage',
          '--disable-software-rasterizer',
          '--js-flags=--max-old-space-size=4096 --expose-gc',
          '--enable-precise-memory-info',
          '--mute-audio',
          '--remote-debugging-port=0',
          '--window-size=1440,900',
          // The realm-server speaks HTTPS+HTTP/2 with a mkcert leaf cert
          // (see infra:ensure-dev-cert). `mkcert -install` is
          // best-effort in CI and doesn't reliably land mkcert's root
          // CA in headless Chrome's trust store, so relax cert checks
          // for the realm fetches the tests make. Safe — the URL is
          // fixed by the host config and the connection is loopback.
          // Chrome 144+ silently demotes `--ignore-certificate-errors`
          // to a dev-only flag unless paired with
          // `--allow-insecure-localhost`; without the pair, every
          // realm fetch fails with `TypeError: Failed to fetch`.
          '--ignore-certificate-errors',
          '--allow-insecure-localhost',
        ].filter(Boolean),
      },
    },
  };

  if (process.env.CI) {
    const junitDir = path.join(__dirname, '..', '..', 'junit');
    fs.mkdirSync(junitDir, { recursive: true });
    const testemLog = fs.createWriteStream(
      path.join(junitDir, 'host-testem.log'),
    );

    const reporters = [
      {
        ReporterClass: TapReporter,
        args: [false, null, { get: () => false }],
      },
      {
        ReporterClass: TapReporter,
        args: [false, testemLog, { get: () => false }],
      },
      {
        ReporterClass: XunitReporter,
        args: [
          false,
          fs.createWriteStream(
            path.join(junitDir, `host-${process.env.HOST_TEST_PARTITION}.xml`),
          ),
          { get: () => false },
        ],
      },
    ];

    const multiReporter = new MultiReporter({ reporters });

    config.reporter = multiReporter;

    // Capture testem's own server-side log of the browser↔testem control
    // channel — socket attach / reconnect (`tryAttach`), the `socket
    // reconnection limit has been exceeded` refusal, `Browser … finished all
    // tests`, and process exit. These events are the only record of the
    // handshake behind a `Browser timeout exceeded` failure (the socket drop
    // the socket_heartbeat_timeout above guards against); the TAP output shows
    // the passing tests but nothing about the socket afterward. It is kept so
    // any such failure is diagnosable directly from the CI artifact.
    //
    // A file-level `debug` option can't reach this: testem's
    // `Api.configureLogging()` binds the log output stream from CLI/default
    // options *before* it reads this config file, so the assignment is
    // ignored. But testem's `log` is a singleton EventEmitter that emits a
    // `log.<level>` event on every message regardless of that stream, so
    // subscribe to those events directly and tee them to a file (uploaded as
    // a CI artifact). `Browser … finished all tests` here is also the
    // authoritative signal that the browser reported suite completion —
    // browser-side `console.log` after the last test isn't reliably flushed
    // into the TAP output, so it can't stand in for this.
    const testemInternalLog = require('testem/lib/log');
    const debugStream = fs.createWriteStream(
      path.join(
        junitDir,
        `host-testem-debug-${process.env.HOST_TEST_PARTITION}.log`,
      ),
    );
    for (const level of [
      'error',
      'warn',
      'notice',
      'info',
      'verbose',
      'http',
      'timing',
    ]) {
      testemInternalLog.on(`log.${level}`, (record) => {
        try {
          const prefix = record && record.prefix ? `${record.prefix} ` : '';
          const message = record ? record.message : '';
          debugStream.write(
            `${new Date().toISOString()} [${level}] ${prefix}${message}\n`,
          );
        } catch (e) {
          // best-effort diagnostics — never let logging break the run
        }
      });
    }

    // A mid-run `Browser timeout exceeded` is testem's disconnect path: the
    // control socket closed and no reconnect arrived within
    // browser_disconnect_timeout. socket.io hands the disconnect a reason that
    // separates the causes — `transport close` (the page went away: renderer
    // crash or navigation), `ping timeout` (the page stopped answering: a hung
    // main thread), `transport error` — but testem discards it. Record it,
    // with socket.io's description, which for `transport error` carries the
    // underlying error.
    const BrowserTestRunner = require('testem/lib/runners/browser_test_runner');
    const onDisconnect = BrowserTestRunner.prototype.onDisconnect;
    BrowserTestRunner.prototype.onDisconnect = function (
      reason,
      description,
      ...rest
    ) {
      try {
        testemInternalLog.warn(
          `browser control socket disconnected: reason=${JSON.stringify(
            reason,
          )} description=${JSON.stringify(
            String(description?.message ?? description ?? ''),
          )} finished=${Boolean(this.finished)} priorDisconnects=${
            this.disconnectCount ?? 0
          }`,
        );
      } catch (e) {
        // best-effort diagnostics — never let logging break the run
      }
      return onDisconnect.call(this, reason, description, ...rest);
    };

    // The browser's lifeline (tests/helpers/lifeline.ts) reports here over
    // plain HTTP, independent of the control socket, so its record of the
    // running test, main-thread liveness and any cross-document navigation
    // survives the socket dropping. A GET answers 204 so the page can tell
    // the endpoint exists; outside CI it is absent and the lifeline stays off.
    //
    // Mounted by wrapping testem's own middleware injection rather than
    // through the `middleware` option: `ember test` passes its addon
    // middlewares as that option, which replaces any list set here.
    const mountLifeline = (app) => {
      app.get('/__host-test-lifeline', (req, res) => {
        res.status(204).end();
      });
      app.post('/__host-test-lifeline', (req, res) => {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
          if (body.length < 16384) {
            body += chunk;
          }
        });
        req.on('end', () => {
          try {
            debugStream.write(
              `${new Date().toISOString()} [lifeline] ${body
                .replace(/\s+/g, ' ')
                .slice(0, 16384)}\n`,
            );
          } catch (e) {
            // best-effort diagnostics — never let logging break the run
          }
          res.status(204).end();
        });
      });
    };
    const TestemServer = require('testem/lib/server');
    const injectMiddleware = TestemServer.prototype.injectMiddleware;
    TestemServer.prototype.injectMiddleware = function (app, ...rest) {
      mountLifeline(app);
      return injectMiddleware.call(this, app, ...rest);
    };
  }

  module.exports = config;
}
