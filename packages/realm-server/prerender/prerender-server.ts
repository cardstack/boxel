import '../instrument';
import '../setup-logger';
import '../lib/wtfnode-on-signal';
import { writeSync } from 'node:fs';
import { logger } from '@cardstack/runtime-common';
import yargs from 'yargs';
import type { Server } from 'http';
import { createPrerenderHttpServer } from './prerender-app';

// FD-level synchronous stderr write — `writeSync(2, ...)` calls the
// write(2) syscall directly, bypassing Node's stream layer.
// `process.stderr.write` is libuv-async when stderr is a pipe (the
// Docker / ECS case), so it can be lost if the process exits before
// libuv flushes. Stamps that fire just before death need to use the
// FD-level form. Proof the Node process actually started, at what
// pid/ppid, independent of the logger pipeline.
writeSync(
  2,
  `[prerender-server] STARTUP pid=${process.pid} ppid=${process.ppid} argv=${JSON.stringify(process.argv)}\n`,
);

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

// `writeSync(2, ...)` (FD-level, syscall-synchronous) for the same
// reason as the STARTUP stamp at the top of this file.
process.on('SIGINT', () => {
  writeSync(
    2,
    `[prerender-server] SIGINT received pid=${process.pid} ppid=${process.ppid}\n`,
  );
  shutdown();
});
process.on('SIGTERM', () => {
  writeSync(
    2,
    `[prerender-server] SIGTERM received pid=${process.pid} ppid=${process.ppid}\n`,
  );
  shutdown();
});
