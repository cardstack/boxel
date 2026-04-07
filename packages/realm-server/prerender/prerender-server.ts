import '../instrument';
import '../setup-logger';
import { logger } from '@cardstack/runtime-common';
import yargs from 'yargs';
import type { Server } from 'http';
import { createPrerenderHttpServer } from './prerender-app';

let log = logger('prerender-server');

let { port, count } = yargs(process.argv.slice(2))
  .usage('Start prerender server')
  .options({
    port: {
      description: 'HTTP port for prerender server',
      demandOption: true,
      type: 'number',
    },
    count: {
      description: 'Number of prerender server instances to start',
      type: 'number',
      default: 1,
    },
  })
  .parseSync();

let servers: Server[] = [];

for (let i = 0; i < count; i++) {
  // When running multiple instances, use port 0 (OS-assigned) for all but the first
  let instancePort = count > 1 ? 0 : port;
  let server = createPrerenderHttpServer({
    port: instancePort,
  }).listen(instancePort);
  servers.push(server);
  server.on('listening', () => {
    let actualPort =
      (server.address() as import('net').AddressInfo).port ?? instancePort;
    log.info(
      `prerender server instance ${i + 1}/${count} HTTP listening on port ${actualPort}`,
    );
  });
}

function shutdown() {
  log.info(`Shutting down ${servers.length} prerender server(s)...`);
  let remaining = servers.length;
  for (let server of servers) {
    (server as any).closeAllConnections?.();
    server.close((err?: Error) => {
      if (err) {
        log.error(`Error while closing prerender server:`, err);
      }
      remaining--;
      if (remaining <= 0) {
        log.info(`All prerender servers have stopped.`);
        process.exit(err ? 1 : 0);
      }
    });
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
