// @ts-nocheck
import { writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../realm-server/setup-logger.ts');
const {
  createPrerenderHttpServer,
} = require('../../../realm-server/prerender/prerender-app.ts');

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    let server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      let address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('unable to determine free port')));
        return;
      }
      let { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function closeServer(server: {
  close(cb: (error?: Error) => void): void;
}) {
  await new Promise<void>((resolve, reject) =>
    server.close((error?: Error) => (error ? reject(error) : resolve())),
  );
}

try {
  let port = await getFreePort();
  let server = createPrerenderHttpServer({
    silent: Boolean(process.env.SILENT_PRERENDERER),
    maxPages: Number(process.env.SOFTWARE_FACTORY_PRERENDER_MAX_PAGES ?? 2),
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  let payload = {
    url: `http://127.0.0.1:${port}`,
  };

  if (process.env.SOFTWARE_FACTORY_METADATA_FILE) {
    writeFileSync(
      process.env.SOFTWARE_FACTORY_METADATA_FILE,
      JSON.stringify(payload, null, 2),
    );
  }

  console.log(JSON.stringify(payload, null, 2));

  let stop = async () => {
    if (typeof server.__stopPrerenderer === 'function') {
      await server.__stopPrerenderer();
    }
    if (server.listening) {
      await closeServer(server);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
} catch (error) {
  console.error(error);
  process.exit(1);
}
