import '../instrument';
import '../setup-logger';
import { logger } from '@cardstack/runtime-common';
import yargs from 'yargs';
import { Server } from 'http';
import { createPrerenderHttpServer } from './prerender-app';

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

const REALM_SECRET_SEED = process.env.REALM_SECRET_SEED;
if (!REALM_SECRET_SEED) {
  console.error(
    `The REALM_SECRET_SEED environment variable is not set. Please make sure this env var has a value`,
  );
  process.exit(-1);
}

let webServerInstance: Server | undefined;
webServerInstance = createPrerenderHttpServer({
  secretSeed: REALM_SECRET_SEED,
  silent,
  port,
}).listen(port);
log.info(`prerender server HTTP listening on port ${port}`);

function shutdown() {
  log.info(`Shutting down prerender server...`);
  (webServerInstance as any)?.closeAllConnections?.();
  webServerInstance?.close((err?: Error) => {
    if (err) {
      log.error(`Error while closing prerender server:`, err);
      process.exit(1);
    }
    log.info(`prerender server HTTP on port ${port} has stopped.`);
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
