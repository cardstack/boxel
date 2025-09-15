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
import { prerenderCard, type PermissionsMap } from './index';

let log = logger('prerender-server');

export function buildPrerenderApp(
  secretSeed: string,
): Koa<Koa.DefaultState, Koa.Context> {
  if (!secretSeed) {
    throw new Error(`REALM_SECRET_SEED is required to start prerender server`);
  }

  let app = new Koa<Koa.DefaultState, Koa.Context>();
  let router = new Router();

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

      if (!url || !userId || !permissions || typeof permissions !== 'object') {
        ctxt.status = 400;
        ctxt.body = {
          errors: [
            {
              status: 400,
              message:
                'Missing or invalid required attributes: url, userId, permissions',
            },
          ],
        };
        return;
      }

      let start = Date.now();
      let { response, timings } = await prerenderCard({
        url,
        userId,
        secretSeed,
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

  return app;
}

export function createPrerenderHttpServer(options?: {
  secretSeed?: string;
}): Server {
  let secretSeed = options?.secretSeed ?? process.env.REALM_SECRET_SEED ?? '';
  let app = buildPrerenderApp(secretSeed);
  return createServer(app.callback());
}
