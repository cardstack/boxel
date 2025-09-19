import '../instrument';
import '../setup-logger';
import { logger } from '@cardstack/runtime-common';
import { Server, createServer } from 'http';
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

let webServerInstance: Server | undefined;
let { app } = buildPrerenderManagerApp();
webServerInstance = createServer(app.callback()).listen(port);
log.info(`prerender manager HTTP listening on port ${port}`);

function shutdown() {
  log.info(`Shutting down prerender manager...`);
  (webServerInstance as any)?.closeAllConnections?.();
  webServerInstance?.close((err?: Error) => {
    if (err) {
      log.error(`Error while closing prerender manager:`, err);
      process.exit(1);
    }
    log.info(`prerender manager HTTP on port ${port} has stopped.`);
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
