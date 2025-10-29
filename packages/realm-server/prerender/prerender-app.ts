import Koa from 'koa';
import Router from '@koa/router';
import { Server, createServer } from 'http';
import * as Sentry from '@sentry/node';
import {
  logger,
  type RealmPermissions,
  type RenderRouteOptions,
} from '@cardstack/runtime-common';
import {
  ecsMetadata,
  fullRequestURL,
  livenessCheck,
  fetchRequestFromContext,
} from '../middleware';
import { Prerenderer } from './index';
import { resolvePrerenderManagerURL } from './config';

let log = logger('prerender-server');
const defaultPrerenderServerPort = 4221;

export function buildPrerenderApp(
  secretSeed: string,
  options: { serverURL: string; maxPages?: number; silent?: boolean },
): {
  app: Koa<Koa.DefaultState, Koa.Context>;
  prerenderer: Prerenderer;
} {
  let app = new Koa<Koa.DefaultState, Koa.Context>();
  let router = new Router();
  let maxPages =
    options?.maxPages ?? Number(process.env.PRERENDER_PAGE_POOL_SIZE ?? 4);
  let silent = options?.silent || process.env.PRERENDER_SILENT === 'true';
  let prerenderer = new Prerenderer({
    secretSeed,
    maxPages,
    silent,
    serverURL: options.serverURL,
  });

  router.head('/', livenessCheck);
  router.get('/', async (ctxt: Koa.Context) => {
    ctxt.set('Content-Type', 'application/json');
    ctxt.body = JSON.stringify({ ready: true });
    ctxt.status = 200;
  });

  router.post('/prerender', async (ctxt: Koa.Context) => {
    try {
      let request = await fetchRequestFromContext(ctxt);
      let raw = await request.text();
      let body: any;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        ctxt.status = 400;
        ctxt.body = {
          errors: [
            {
              status: 400,
              message: 'Invalid JSON body',
            },
          ],
        };
        return;
      }

      let attrs = body?.data?.attributes ?? {};
      let url = attrs.url as string | undefined;
      let userId = attrs.userId as string | undefined;
      let permissions = attrs.permissions as RealmPermissions | undefined;
      let realm = attrs.realm as string | undefined;
      let renderOptions: RenderRouteOptions =
        attrs.renderOptions &&
        typeof attrs.renderOptions === 'object' &&
        !Array.isArray(attrs.renderOptions)
          ? (attrs.renderOptions as RenderRouteOptions)
          : {};

      log.debug(
        `received prerender request ${url}: realm=${realm} userId=${userId} options=${JSON.stringify(renderOptions)} permissions=${JSON.stringify(permissions)}`,
      );
      if (
        !url ||
        !userId ||
        !permissions ||
        typeof permissions !== 'object' ||
        !realm
      ) {
        ctxt.status = 400;
        ctxt.body = {
          errors: [
            {
              status: 400,
              message:
                'Missing or invalid required attributes: url, userId, permissions, realm',
            },
          ],
        };
        return;
      }

      let start = Date.now();
      let { response, timings, pool } = await prerenderer.prerenderCard({
        realm,
        url,
        userId,
        permissions,
        renderOptions,
      });
      let totalMs = Date.now() - start;
      let poolFlags = Object.entries({
        reused: pool.reused,
        evicted: pool.evicted,
        timedOut: pool.timedOut,
      })
        .filter(([, value]) => value === true)
        .map(([key]) => key)
        .join(', ');
      let poolFlagSuffix = poolFlags.length > 0 ? ` flags=[${poolFlags}]` : '';
      log.info(
        'prerendered %s total=%dms launch=%dms render=%dms pageId=%s realm=%s%s',
        url,
        totalMs,
        timings.launchMs,
        timings.renderMs,
        pool.pageId,
        pool.realm,
        poolFlagSuffix,
      );
      ctxt.status = 201;
      ctxt.set('Content-Type', 'application/vnd.api+json');
      ctxt.body = {
        data: {
          type: 'prerender-result',
          id: url,
          attributes: response,
        },
        meta: {
          timing: {
            launchMs: timings.launchMs,
            renderMs: timings.renderMs,
            totalMs,
          },
          pool,
        },
      };
      if (pool.timedOut) {
        log.warn(`render of ${url} timed out`);
      }
      if (response.error) {
        log.debug(
          `render of ${url} resulted in error doc:\n${JSON.stringify(response.error, null, 2)}`,
        );
      } else {
        log.debug(
          `render of ${url} resulted in search doc:\n${JSON.stringify(response.searchDoc, null, 2)}`,
        );
      }
    } catch (err: any) {
      Sentry.captureException(err);
      log.error(`Unhandled error in /prerender:`, err);
      ctxt.status = 500;
      ctxt.body = {
        errors: [
          {
            status: 500,
            message: err?.message ?? 'Unknown error',
          },
        ],
      };
    }
  });

  app
    .use((ctxt: Koa.Context, next: Koa.Next) => {
      log.info(
        `<-- ${ctxt.method} ${ctxt.req.headers.accept} ${fullRequestURL(ctxt).href}`,
      );
      ctxt.res.on('finish', () => {
        log.info(
          `--> ${ctxt.method} ${ctxt.req.headers.accept} ${fullRequestURL(ctxt).href}: ${ctxt.status}`,
        );
        log.debug(JSON.stringify(ctxt.req.headers));
      });
      return next();
    })
    .use(ecsMetadata)
    .use(router.routes());

  app.on('error', (err: any) => {
    log.error(`prerender server HTTP error: ${err.message}`);
  });

  return { app, prerenderer };
}

function resolvePrerenderServerURL(port?: number): string {
  let hostname = process.env.HOSTNAME ?? 'localhost';
  let resolvedPort = port ?? defaultPrerenderServerPort;
  let portSuffix = resolvedPort ? `:${resolvedPort}` : '';
  return `http://${hostname}${portSuffix}`.replace(/\/$/, '');
}

async function registerWithManager(serverURL: string) {
  try {
    const managerURL = resolvePrerenderManagerURL();
    const capacity = Number(process.env.PRERENDER_PAGE_POOL_SIZE ?? 4);
    let body = {
      data: {
        type: 'prerender-server',
        attributes: {
          capacity,
          url: serverURL,
        },
      },
    };
    await fetch(`${managerURL}/prerender-servers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.api+json',
        Accept: 'application/vnd.api+json',
      },
      body: JSON.stringify(body),
    }).catch((e) => {
      log.debug('Prerender manager registration request failed:', e);
    });
  } catch (e) {
    // best-effort, but log for visibility
    log.debug('Error while attempting to register with prerender manager:', e);
  }
}

async function unregisterWithManager(serverURL: string) {
  try {
    const managerURL = resolvePrerenderManagerURL();
    let target = new URL(`${managerURL}/prerender-servers`);
    target.searchParams.set('url', serverURL);
    await fetch(target.toString(), { method: 'DELETE' }).catch((e) => {
      log.debug('Prerender manager unregister request failed:', e);
    });
  } catch (e) {
    log.debug(
      'Error while attempting to unregister with prerender manager:',
      e,
    );
  }
}

export function createPrerenderHttpServer(options?: {
  secretSeed?: string;
  maxPages?: number;
  silent?: boolean;
  port?: number;
}): Server {
  let secretSeed = options?.secretSeed ?? process.env.REALM_SECRET_SEED ?? '';
  let silent = options?.silent || process.env.PRERENDER_SILENT === 'true';
  let serverURL = resolvePrerenderServerURL(options?.port);
  let { app, prerenderer } = buildPrerenderApp(secretSeed, {
    maxPages: options?.maxPages,
    silent,
    serverURL,
  });
  let server = createServer(app.callback());
  server.on('close', async () => {
    try {
      await prerenderer.stop();
    } catch (e: any) {
      // Best-effort shutdown; log and continue
      log.warn('Error stopping prerenderer on server close:', e?.message ?? e);
    }
    try {
      await unregisterWithManager(serverURL);
    } catch (e) {
      log.debug(
        'Error scheduling unregister with prerender manager:',
        e as any,
      );
    }
  });
  // best-effort registration (async, non-blocking)
  server.on('listening', () => {
    try {
      void registerWithManager(serverURL);
    } catch (e) {
      log.debug('Error scheduling registration with prerender manager:', e);
    }
  });
  return server;
}
