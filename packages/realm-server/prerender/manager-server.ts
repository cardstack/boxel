import '../instrument';
import '../setup-logger';
import { logger } from '@cardstack/runtime-common';
import type { Server } from 'http';
import { createServer } from 'http';
import yargs from 'yargs';
import { buildPrerenderManagerApp } from './manager-app';

let log = logger('prerender-manager');

let { port, exitOnSignal, forceExitTimeoutMs } = yargs(process.argv.slice(2))
  .usage('Start prerender manager')
  .options({
    port: {
      description: 'HTTP port for prerender manager',
      demandOption: true,
      type: 'number',
    },
    exitOnSignal: {
      description:
        'Close the server and exit when receiving a shutdown signal (useful for local development)',
      default: false,
      type: 'boolean',
    },
    forceExitTimeoutMs: {
      description:
        'When exitOnSignal is true, force the process to exit after this timeout (ms)',
      default: 150000,
      type: 'number',
    },
  })
  .parseSync();

let draining = false;
let { app } = buildPrerenderManagerApp({
  isDraining: () => draining,
});
let _webServerInstance: Server | undefined;
_webServerInstance = createServer(app.callback()).listen(port);
log.info(`prerender manager HTTP listening on port ${port}`);

function shutdown(signal: NodeJS.Signals) {
  if (draining) return;
  draining = true;
  log.info(
    'Received %s; marking prerender manager as draining and refusing new work',
    signal,
  );
  _webServerInstance?.getConnections((err, count) => {
    if (err) {
      log.warn('Unable to read current connection count during shutdown:', err);
    } else {
      log.info('Prerender manager draining with %s open connections', count);
    }
  });
  if (exitOnSignal) {
    log.info(
      'Closing prerender manager listener after shutdown signal and exiting process',
    );
    _webServerInstance?.close(() => {
      log.info('Prerender manager listener closed; exiting process');
      process.exit(0);
    });
    let forceExitTimer = setTimeout(() => {
      log.warn(
        'Forcing prerender manager shutdown after %s ms timeout',
        forceExitTimeoutMs,
      );
      process.exit(0);
    }, forceExitTimeoutMs);
    forceExitTimer.unref();
  }
  // keep listener alive in non-exitOnSignal mode so clients get fast draining responses; rely on
  // process manager to terminate after grace period.
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
