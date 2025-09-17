import Koa from 'koa';
import Router from '@koa/router';
import { Server, createServer } from 'http';
import * as Sentry from '@sentry/node';
import { logger } from '@cardstack/runtime-common';
import {
  ecsMetadata,
  fullRequestURL,
  livenessCheck,
  fetchRequestFromContext,
} from '../middleware';
import { Prerenderer, type PermissionsMap } from './index';

let log = logger('prerender-server');

export function buildPrerenderApp(secretSeed: string): {
  app: Koa<Koa.DefaultState, Koa.Context>;
  prerenderer: Prerenderer;
} {
  let app = new Koa<Koa.DefaultState, Koa.Context>();
  let router = new Router();
  let maxPages = Number(process.env.PRERENDER_PAGE_POOL_SIZE ?? 4);
  let prerenderer = new Prerenderer({ secretSeed, maxPages });

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
      let permissions = attrs.permissions as PermissionsMap | undefined;
      let realm = attrs.realm as string | undefined;

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
      });
      let totalMs = Date.now() - start;
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

export function createPrerenderHttpServer(options?: {
  secretSeed?: string;
}): Server {
  let secretSeed = options?.secretSeed ?? process.env.REALM_SECRET_SEED ?? '';
  let { app, prerenderer } = buildPrerenderApp(secretSeed);
  let server = createServer(app.callback());
  server.on('close', async () => {
    try {
      await prerenderer.stop();
    } catch {}
  });
  return server;
}
