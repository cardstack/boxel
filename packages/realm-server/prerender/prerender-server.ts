import '../instrument';
import '../setup-logger';
import { logger } from '@cardstack/runtime-common';
import yargs from 'yargs';
import type { Server } from 'http';
import { createPrerenderHttpServer } from './prerender-app';
import {
  isEnvironmentMode,
  registerService,
} from '../lib/dev-service-registry';

let log = logger('prerender-server');

let { port, silent } = yargs(process.argv.slice(2))
  .usage('Start prerender server')
  .options({
    port: {
      description: 'HTTP port for prerender server',
      demandOption: true,
      type: 'number',
    },
    silent: {
      description: 'Disable forwarding Puppeteer console output to server logs',
      type: 'boolean',
      default: false,
    },
  })
  .parseSync();

let webServerInstance: Server | undefined;
webServerInstance = createPrerenderHttpServer({
  silent,
  port,
}).listen(port);
let actualPort = port;
webServerInstance.on('listening', () => {
  actualPort =
    (webServerInstance!.address() as import('net').AddressInfo).port ?? port;
  if (isEnvironmentMode()) {
    registerService(
      webServerInstance!,
      process.env.PRERENDER_SERVICE_NAME || 'prerender',
    );
  }
  log.info(`prerender server HTTP listening on port ${actualPort}`);
});

function shutdown() {
  log.info(`Shutting down prerender server...`);
  (webServerInstance as any)?.closeAllConnections?.();
  webServerInstance?.close((err?: Error) => {
    if (err) {
      log.error(`Error while closing prerender server:`, err);
      process.exit(1);
    }
    log.info(`prerender server HTTP on port ${actualPort} has stopped.`);
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
