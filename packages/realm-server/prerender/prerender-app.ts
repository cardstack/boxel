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

let log = logger('prerender-server');

export function buildPrerenderApp(
  secretSeed: string,
  options?: { maxPages?: number; silent?: boolean },
): {
  app: Koa<Koa.DefaultState, Koa.Context>;
  prerenderer: Prerenderer;
} {
  let app = new Koa<Koa.DefaultState, Koa.Context>();
  let router = new Router();
  let maxPages =
    options?.maxPages ?? Number(process.env.PRERENDER_PAGE_POOL_SIZE ?? 4);
  let silent = options?.silent || process.env.PRERENDER_SILENT === 'true';
  let prerenderer = new Prerenderer({ secretSeed, maxPages, silent });

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

async function registerWithManager() {
  try {
    const managerURL =
      process.env.PRERENDER_MANAGER_URL ?? 'http://localhost:4222';
    const capacity = Number(process.env.PRERENDER_PAGE_POOL_SIZE ?? 4);
    const urlOverride = process.env.PRERENDER_SERVER_URL; // optional explicit URL
    let body = {
      data: {
        type: 'prerender-server',
        attributes: {
          capacity,
          ...(urlOverride ? { url: urlOverride } : {}),
        },
      },
    };
    await fetch(`${managerURL.replace(/\/$/, '')}/prerender-servers`, {
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

export function createPrerenderHttpServer(options?: {
  secretSeed?: string;
  maxPages?: number;
  silent?: boolean;
}): Server {
  let secretSeed = options?.secretSeed ?? process.env.REALM_SECRET_SEED ?? '';
  let silent = options?.silent || process.env.PRERENDER_SILENT === 'true';
  let { app, prerenderer } = buildPrerenderApp(secretSeed, {
    maxPages: options?.maxPages,
    silent,
  });
  let server = createServer(app.callback());
  server.on('close', async () => {
    try {
      await prerenderer.stop();
    } catch (e: any) {
      // Best-effort shutdown; log and continue
      log.warn('Error stopping prerenderer on server close:', e?.message ?? e);
    }
  });
  // best-effort registration (async, non-blocking)
  server.on('listening', () => {
    try {
      registerWithManager();
    } catch (e) {
      log.debug('Error scheduling registration with prerender manager:', e);
    }
  });
  return server;
}
