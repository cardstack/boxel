import '../instrument';
import '../setup-logger';
import { logger } from '@cardstack/runtime-common';
import type { Server } from 'http';
import { createServer } from 'http';
import yargs from 'yargs';
import { buildPrerenderManagerApp } from './manager-app';

let log = logger('prerender-manager');

let { port } = yargs(process.argv.slice(2))
  .usage('Start prerender manager')
  .options({
    port: {
      description: 'HTTP port for prerender manager',
      demandOption: true,
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

function shutdown() {
  if (draining) return;
  draining = true;
  log.info(
    'Received shutdown signal; marking prerender manager as draining and refusing new work',
  );
  _webServerInstance?.getConnections((err, count) => {
    if (err) {
      log.warn('Unable to read current connection count during shutdown:', err);
    } else {
      log.info('Prerender manager draining with %s open connections', count);
    }
  });
  // keep listener alive so clients get fast draining responses; rely on
  // process manager to terminate after grace period.
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
