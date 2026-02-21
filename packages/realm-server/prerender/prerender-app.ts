import Koa from 'koa';
import Router from '@koa/router';
import type { Server } from 'http';
import { createServer } from 'http';
import * as Sentry from '@sentry/node';
import {
  Deferred,
  logger,
  type RenderRouteOptions,
  type RenderResponse,
  type ModuleRenderResponse,
  type FileExtractResponse,
  type FileRenderResponse,
  type RunCommandResponse,
} from '@cardstack/runtime-common';
import {
  ecsMetadata,
  fullRequestURL,
  livenessCheck,
  fetchRequestFromContext,
} from '../middleware';
import { Prerenderer } from './index';
import { resolvePrerenderManagerURL } from './config';
import {
  PRERENDER_SERVER_DRAINING_STATUS_CODE,
  PRERENDER_SERVER_STATUS_DRAINING,
  PRERENDER_SERVER_STATUS_HEADER,
} from './prerender-constants';

type PrerenderServer = Server & {
  __stopPrerenderer?: () => Promise<void>;
};

let log = logger('prerender-server');
const defaultPrerenderServerPort = 4221;

export function buildPrerenderApp(options: {
  serverURL: string;
  maxPages?: number;
  isDraining?: () => boolean;
  drainingPromise?: Promise<void>;
}): {
  app: Koa<Koa.DefaultState, Koa.Context>;
  prerenderer: Prerenderer;
} {
  let app = new Koa<Koa.DefaultState, Koa.Context>();
  let router = new Router();
  let maxPages =
    options?.maxPages ?? Number(process.env.PRERENDER_PAGE_POOL_SIZE ?? 4);
  let prerenderer = new Prerenderer({
    maxPages,
    serverURL: options.serverURL,
  });

  router.head('/', (ctxt: Koa.Context) => {
    if (options.isDraining?.()) {
      ctxt.status = PRERENDER_SERVER_DRAINING_STATUS_CODE;
      ctxt.set(
        PRERENDER_SERVER_STATUS_HEADER,
        PRERENDER_SERVER_STATUS_DRAINING,
      );
      return;
    }
    return livenessCheck(ctxt, async () => undefined);
  });
  router.get('/', async (ctxt: Koa.Context) => {
    if (options.isDraining?.()) {
      ctxt.status = PRERENDER_SERVER_DRAINING_STATUS_CODE;
      ctxt.set(
        PRERENDER_SERVER_STATUS_HEADER,
        PRERENDER_SERVER_STATUS_DRAINING,
      );
      ctxt.set('Content-Type', 'application/json');
      ctxt.body = JSON.stringify({ ready: false, draining: true });
      return;
    }
    ctxt.set('Content-Type', 'application/json');
    ctxt.body = JSON.stringify({ ready: true });
    ctxt.status = 200;
  });

  type RouteBaseArgs = {
    realm: string;
    auth: string;
    renderOptions: RenderRouteOptions;
  };

  type PrerenderArgs = RouteBaseArgs & {
    url: string;
  };

  type RunCommandRouteArgs = RouteBaseArgs & {
    command: string;
    commandInput?: unknown;
  };

  type RouteParseResult<A extends RouteBaseArgs> = {
    args?: A;
    missing: string[];
    missingMessage: string;
    logTarget: string;
    responseId: string;
    rejectionLogDetails: string;
  };

  type PrerenderExecResult<R> = {
    response: R;
    timings: { launchMs: number; renderMs: number };
    pool: {
      pageId: string;
      realm: string;
      reused: boolean;
      evicted: boolean;
      timedOut: boolean;
    };
  };

  let isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

  let parseRenderOptions = (attrs: any): RenderRouteOptions =>
    attrs.renderOptions &&
    typeof attrs.renderOptions === 'object' &&
    !Array.isArray(attrs.renderOptions)
      ? (attrs.renderOptions as RenderRouteOptions)
      : {};

  let missingAttrs = (attrsToCheck: { value: unknown; name: string }[]) =>
    attrsToCheck
      .filter(({ value }) => !isNonEmptyString(value))
      .map(({ name }) => name);

  let parseDefaultPrerenderAttributes = (
    attrs: any,
  ): RouteParseResult<PrerenderArgs> => {
    let rawUrl = attrs.url;
    let rawAuth = attrs.auth;
    let rawRealm = attrs.realm;
    let renderOptions = parseRenderOptions(attrs);
    let missing = missingAttrs([
      { value: rawUrl, name: 'url' },
      { value: rawRealm, name: 'realm' },
      { value: rawAuth, name: 'auth' },
    ]);
    return {
      args:
        missing.length > 0
          ? undefined
          : {
              realm: rawRealm as string,
              url: rawUrl as string,
              auth: rawAuth as string,
              renderOptions,
            },
      missing,
      missingMessage:
        'Missing or invalid required attributes: url, auth, realm',
      logTarget: (rawUrl as string | undefined) ?? '<missing>',
      responseId: (rawUrl as string | undefined) ?? 'unknown',
      rejectionLogDetails: `realm=${
        (rawRealm as string | undefined) ?? '<missing>'
      } url=${(rawUrl as string | undefined) ?? '<missing>'} authProvided=${
        typeof rawAuth === 'string' && rawAuth.trim().length > 0
      }`,
    };
  };

  let parseRunCommandAttributes = (
    attrs: any,
  ): RouteParseResult<RunCommandRouteArgs> => {
    let rawAuth = attrs.auth;
    let rawRealm = attrs.realm;
    let command = attrs.command;
    let commandInput = attrs.commandInput;
    let renderOptions = parseRenderOptions(attrs);
    let missing: string[] = [];
    if (!isNonEmptyString(rawRealm)) missing.push('realm');
    if (!isNonEmptyString(rawAuth)) missing.push('auth');
    if (!isNonEmptyString(command)) missing.push('command');
    let commandValue = isNonEmptyString(command) ? command : undefined;
    return {
      args:
        missing.length > 0
          ? undefined
          : {
              realm: rawRealm as string,
              auth: rawAuth as string,
              command: command as string,
              commandInput,
              renderOptions,
            },
      missing,
      missingMessage:
        'Missing or invalid required attributes: realm, auth, command',
      logTarget: commandValue ?? '<unknown>',
      responseId: commandValue ?? 'command',
      rejectionLogDetails: `realm=${
        (rawRealm as string | undefined) ?? '<missing>'
      } authProvided=${
        typeof rawAuth === 'string' && rawAuth.trim().length > 0
      } commandProvided=${Boolean(commandValue)}`,
    };
  };

  function registerPrerenderRoute<R, A extends RouteBaseArgs = PrerenderArgs>(
    path: string,
    options: {
      requestDescription: string;
      responseType: string;
      infoLabel: string;
      warnTimeoutMessage: (target: string) => string;
      errorContext: string;
      execute: (args: A) => Promise<PrerenderExecResult<R>>;
      afterResponse?: (target: string, response: R) => void;
      parseAttributes?: (attrs: any) => RouteParseResult<A>;
      errorMessage?: string | ((err: any) => string);
      drainingPromise?: Promise<void>;
    },
  ) {
    router.post(path, async (ctxt: Koa.Context) => {
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
        let parsed = options.parseAttributes
          ? options.parseAttributes(attrs)
          : (parseDefaultPrerenderAttributes(attrs) as RouteParseResult<A>);
        let routeArgs = parsed.args;
        let realmForLog = routeArgs?.realm ?? (attrs.realm as string);
        let renderOptionsForLog = routeArgs?.renderOptions ?? {};

        log.debug(
          `received ${options.requestDescription} ${parsed.logTarget}: realm=${realmForLog} options=${JSON.stringify(renderOptionsForLog)}`,
        );
        if (parsed.missing.length > 0 || !routeArgs) {
          log.warn(
            'Rejecting %s due to missing attributes (%s); %s',
            options.requestDescription,
            parsed.missing.join(', '),
            parsed.rejectionLogDetails,
          );
          ctxt.status = 400;
          ctxt.body = {
            errors: [
              {
                status: 400,
                message: parsed.missingMessage,
              },
            ],
          };
          return;
        }

        let start = Date.now();
        let execPromise = options
          .execute(routeArgs)
          .then((result) => ({ result }));
        let drainPromise = options.drainingPromise
          ? options.drainingPromise.then(() => ({ draining: true as const }))
          : null;
        let raceResult = drainPromise
          ? await Promise.race([execPromise, drainPromise])
          : await execPromise;
        if ('draining' in raceResult) {
          // Ensure execute completion does not raise unhandled rejections after we respond.
          execPromise.catch((e) =>
            log.debug('prerender execute settled after drain (ignored):', e),
          );
          ctxt.status = PRERENDER_SERVER_DRAINING_STATUS_CODE;
          ctxt.set(
            PRERENDER_SERVER_STATUS_HEADER,
            PRERENDER_SERVER_STATUS_DRAINING,
          );
          ctxt.body = {
            errors: [
              {
                status: PRERENDER_SERVER_DRAINING_STATUS_CODE,
                message: 'Prerender server draining',
              },
            ],
          };
          return;
        }
        let { response, timings, pool } = raceResult.result;
        let totalMs = Date.now() - start;
        let poolFlags = Object.entries({
          reused: pool.reused,
          evicted: pool.evicted,
          timedOut: pool.timedOut,
        })
          .filter(([, value]) => value === true)
          .map(([key]) => key)
          .join(', ');
        let poolFlagSuffix =
          poolFlags.length > 0 ? ` flags=[${poolFlags}]` : '';
        log.info(
          '%s %s total=%dms launch=%dms render=%dms pageId=%s realm=%s%s',
          options.infoLabel,
          parsed.logTarget,
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
            type: options.responseType,
            id: parsed.responseId,
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
          log.warn(options.warnTimeoutMessage(parsed.logTarget));
        }
        options.afterResponse?.(parsed.logTarget, response);
      } catch (err: any) {
        Sentry.captureException(err);
        log.error(`Unhandled error in ${options.errorContext}:`, err);
        ctxt.status = 500;
        let message =
          typeof options.errorMessage === 'function'
            ? options.errorMessage(err)
            : (options.errorMessage ?? err?.message ?? 'Unknown error');
        ctxt.body = {
          errors: [
            {
              status: 500,
              message,
            },
          ],
        };
      }
    });
  }

  registerPrerenderRoute('/prerender-card', {
    requestDescription: 'prerender request',
    responseType: 'prerender-result',
    infoLabel: 'prerendered',
    warnTimeoutMessage: (url) => `render of ${url} timed out`,
    errorContext: '/prerender-card',
    execute: (args) => prerenderer.prerenderCard(args),
    drainingPromise: options.drainingPromise,
    afterResponse: (url, response) => {
      const cardResponse = response as RenderResponse;
      if (cardResponse.error) {
        log.debug(
          `render of ${url} resulted in error doc:\n${JSON.stringify(cardResponse.error, null, 2)}`,
        );
      } else {
        log.debug(
          `render of ${url} resulted in search doc:\n${JSON.stringify(cardResponse.searchDoc, null, 2)}`,
        );
      }
    },
  });

  registerPrerenderRoute('/prerender-module', {
    requestDescription: 'module prerender request',
    responseType: 'prerender-module-result',
    infoLabel: 'module prerendered',
    warnTimeoutMessage: (url) => `module render of ${url} timed out`,
    errorContext: '/prerender-module',
    execute: (args) => prerenderer.prerenderModule(args),
    drainingPromise: options.drainingPromise,
    afterResponse: (url, response) => {
      const moduleResponse = response as ModuleRenderResponse;
      if (moduleResponse.status === 'error' && moduleResponse.error) {
        log.debug(
          `module render of ${url} resulted in error doc:\n${JSON.stringify(moduleResponse.error, null, 2)}`,
        );
      }
    },
  });

  registerPrerenderRoute('/prerender-file-extract', {
    requestDescription: 'file extract prerender request',
    responseType: 'prerender-file-extract-result',
    infoLabel: 'file extract prerendered',
    warnTimeoutMessage: (url) => `file extract render of ${url} timed out`,
    errorContext: '/prerender-file-extract',
    execute: (args) => prerenderer.prerenderFileExtract(args),
    drainingPromise: options.drainingPromise,
    afterResponse: (url, response) => {
      const fileResponse = response as FileExtractResponse;
      if (fileResponse.status === 'error' && fileResponse.error) {
        log.debug(
          `file extract of ${url} resulted in error doc:\n${JSON.stringify(fileResponse.error, null, 2)}`,
        );
      }
    },
  });

  registerPrerenderRoute<RunCommandResponse, RunCommandRouteArgs>(
    '/run-command',
    {
      requestDescription: 'command-runner',
      responseType: 'command-result',
      infoLabel: 'command-runner',
      warnTimeoutMessage: (target) => `command run of ${target} timed out`,
      errorContext: '/run-command',
      errorMessage: 'Error running command',
      parseAttributes: parseRunCommandAttributes,
      execute: (args) =>
        prerenderer.runCommand({
          realm: args.realm,
          auth: args.auth,
          command: args.command,
          commandInput: args.commandInput as Record<string, unknown> | null,
        }),
      drainingPromise: options.drainingPromise,
    },
  );

  // File render route needs additional attributes (fileData, types)
  // beyond what registerPrerenderRoute handles, so we register it directly.
  router.post('/prerender-file-render', async (ctxt: Koa.Context) => {
    try {
      let request = await fetchRequestFromContext(ctxt);
      let raw = await request.text();
      let body: any;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        ctxt.status = 400;
        ctxt.body = {
          errors: [{ status: 400, message: 'Invalid JSON body' }],
        };
        return;
      }

      let attrs = body?.data?.attributes ?? {};
      let rawUrl = attrs.url;
      let rawAuth = attrs.auth;
      let rawRealm = attrs.realm;
      let renderOptions: RenderRouteOptions =
        attrs.renderOptions &&
        typeof attrs.renderOptions === 'object' &&
        !Array.isArray(attrs.renderOptions)
          ? (attrs.renderOptions as RenderRouteOptions)
          : {};
      let fileData = attrs.fileData;
      let types = attrs.types;

      let isNonEmptyString = (value: unknown): value is string =>
        typeof value === 'string' && value.trim().length > 0;

      let missing = [
        { value: rawUrl, name: 'url' },
        { value: rawRealm, name: 'realm' },
        { value: rawAuth, name: 'auth' },
      ]
        .filter(({ value }) => !isNonEmptyString(value))
        .map(({ name }) => name);

      if (!fileData) {
        missing.push('fileData');
      }
      if (!Array.isArray(types)) {
        missing.push('types');
      }

      log.debug(
        `received file render prerender request ${rawUrl}: realm=${rawRealm}`,
      );
      if (missing.length > 0) {
        ctxt.status = 400;
        ctxt.body = {
          errors: [
            {
              status: 400,
              message: `Missing or invalid required attributes: ${missing.join(', ')}`,
            },
          ],
        };
        return;
      }

      let realm = rawRealm as string;
      let url = rawUrl as string;
      let auth = rawAuth as string;

      let start = Date.now();
      let execPromise = prerenderer
        .prerenderFileRender({
          realm,
          url,
          auth,
          fileData,
          types,
          renderOptions,
        })
        .then((result) => ({ result }));
      let drainPromise = options.drainingPromise
        ? options.drainingPromise.then(() => ({ draining: true as const }))
        : null;
      let raceResult = drainPromise
        ? await Promise.race([execPromise, drainPromise])
        : await execPromise;
      if ('draining' in raceResult) {
        execPromise.catch((e) =>
          log.debug(
            'file render prerender execute settled after drain (ignored):',
            e,
          ),
        );
        ctxt.status = PRERENDER_SERVER_DRAINING_STATUS_CODE;
        ctxt.set(
          PRERENDER_SERVER_STATUS_HEADER,
          PRERENDER_SERVER_STATUS_DRAINING,
        );
        ctxt.body = {
          errors: [
            {
              status: PRERENDER_SERVER_DRAINING_STATUS_CODE,
              message: 'Prerender server draining',
            },
          ],
        };
        return;
      }
      let { response, timings, pool } = raceResult.result;
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
        'file render prerendered %s total=%dms launch=%dms render=%dms pageId=%s realm=%s%s',
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
          type: 'prerender-file-render-result',
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
        log.warn(`file render of ${url} timed out`);
      }
      const fileResponse = response as FileRenderResponse;
      if (fileResponse.error) {
        log.debug(
          `file render of ${url} resulted in error doc:\n${JSON.stringify(fileResponse.error, null, 2)}`,
        );
      }
    } catch (err: any) {
      Sentry.captureException(err);
      log.error('Unhandled error in /prerender-file-render:', err);
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
      if (
        options.isDraining?.() &&
        ctxt.method === 'POST' &&
        ctxt.path.startsWith('/prerender-')
      ) {
        ctxt.status = PRERENDER_SERVER_DRAINING_STATUS_CODE;
        ctxt.set(
          PRERENDER_SERVER_STATUS_HEADER,
          PRERENDER_SERVER_STATUS_DRAINING,
        );
        ctxt.body = {
          errors: [
            {
              status: PRERENDER_SERVER_DRAINING_STATUS_CODE,
              message: 'Prerender server draining',
            },
          ],
        };
        return;
      }
      return next();
    })
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
  return `http://${hostname}:${resolvedPort}`.replace(/\/$/, '');
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
  maxPages?: number;
  silent?: boolean;
  port?: number;
}): Server {
  let draining = false;
  let drainingResolved = false;
  let drainingDeferred = new Deferred<void>();
  let heartbeatTimer: NodeJS.Timeout | undefined;
  let isClosing = false;
  let fatalExitInProgress = false;
  let serverURL = resolvePrerenderServerURL(options?.port);
  let { app, prerenderer } = buildPrerenderApp({
    maxPages: options?.maxPages,
    serverURL,
    isDraining: () => draining,
    drainingPromise: drainingDeferred.promise,
  });
  let stopPromise: Promise<void> | null = null;

  async function stopPrerendererOnce(): Promise<void> {
    if (!stopPromise) {
      stopPromise = (async () => {
        try {
          await prerenderer.stop();
        } catch (e: any) {
          // Best-effort shutdown; log and continue
          log.warn(
            'Error stopping prerenderer on server close:',
            e?.message ?? e,
          );
        }
      })();
    }
    await stopPromise;
  }
  const heartbeatIntervalMs = Math.max(
    1000,
    Number(process.env.PRERENDER_HEARTBEAT_INTERVAL_MS ?? 5000),
  );
  const shutdownGraceMs = Math.max(
    0,
    Number(process.env.PRERENDER_SHUTDOWN_GRACE_MS ?? 10000),
  );

  async function sendHeartbeat(status?: 'active' | 'draining') {
    try {
      const managerURL = resolvePrerenderManagerURL();
      const capacity = Number(process.env.PRERENDER_PAGE_POOL_SIZE ?? 4);
      let body = {
        data: {
          type: 'prerender-server',
          attributes: {
            capacity,
            url: serverURL,
            status: status ?? (draining ? 'draining' : 'active'),
            warmedRealms: prerenderer.getWarmRealms(),
          },
        },
      };
      log.debug(
        `POST heartbeat to ${managerURL}/prerender-servers with body:\n${JSON.stringify(body, null, 2)}`,
      );
      await fetch(`${managerURL}/prerender-servers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.api+json',
          Accept: 'application/vnd.api+json',
        },
        body: JSON.stringify(body),
      }).catch((e) => {
        log.debug('Prerender manager heartbeat request failed:', e);
      });
    } catch (e) {
      // best-effort, but log for visibility
      log.debug('Error while attempting heartbeat with prerender manager:', e);
    }
  }

  function startHeartbeatLoop() {
    if (heartbeatTimer) return;
    void sendHeartbeat();
    heartbeatTimer = setInterval(() => {
      void sendHeartbeat();
    }, heartbeatIntervalMs);
    (heartbeatTimer as any).unref?.();
  }

  function stopHeartbeatLoop() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  }

  let server = createServer(app.callback()) as PrerenderServer;
  server.__stopPrerenderer = stopPrerendererOnce;

  server.on('close', async () => {
    stopHeartbeatLoop();
    await stopPrerendererOnce();
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
      startHeartbeatLoop();
    } catch (e) {
      log.debug('Error scheduling registration with prerender manager:', e);
    }
  });
  let shutdownHandler = (signal: NodeJS.Signals) => {
    if (draining) return;
    log.info(`Received ${signal}; marking prerender server as draining`);
    draining = true;
    if (!drainingResolved) {
      drainingResolved = true;
      drainingDeferred.fulfill();
    }
    stopHeartbeatLoop();
    void sendHeartbeat('draining');
    const shutdownTimer = setTimeout(() => {
      if (isClosing) return;
      isClosing = true;
      clearTimeout(shutdownTimer);
      server.close(() => {
        log.info(
          `prerender server HTTP on port ${options?.port ?? defaultPrerenderServerPort} has stopped.`,
        );
      });
    }, shutdownGraceMs);
    shutdownTimer.unref();
  };
  process.on('SIGTERM', shutdownHandler);
  process.on('SIGINT', shutdownHandler);

  async function handleFatal(
    type: 'uncaughtException' | 'unhandledRejection',
    err: any,
  ) {
    if (fatalExitInProgress) return;
    fatalExitInProgress = true;
    log.error(`Fatal ${type}; shutting down prerenderer`, err);
    try {
      await prerenderer.stop();
    } catch (e: any) {
      log.warn('Error stopping prerenderer during fatal shutdown:', e);
    }
    try {
      server.close();
    } catch (e: any) {
      log.warn('Error closing server during fatal shutdown:', e);
    }
    setTimeout(() => process.exit(1), 100).unref();
  }

  const uncaughtExceptionHandler = (err: unknown) =>
    handleFatal('uncaughtException', err);
  const unhandledRejectionHandler = (err: unknown) =>
    handleFatal('unhandledRejection', err);
  process.on('uncaughtException', uncaughtExceptionHandler);
  process.on('unhandledRejection', unhandledRejectionHandler);
  server.on('close', () => {
    process.off('SIGTERM', shutdownHandler);
    process.off('SIGINT', shutdownHandler);
    process.off('uncaughtException', uncaughtExceptionHandler);
    process.off('unhandledRejection', unhandledRejectionHandler);
  });
  return server;
}
