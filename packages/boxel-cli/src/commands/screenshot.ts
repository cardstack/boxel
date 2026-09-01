import type { Command } from 'commander';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { resolveRealmAuthenticator } from '../lib/auth-resolver.ts';
import { cliLog } from '../lib/cli-log.ts';
import { FG_CYAN, FG_GREEN, FG_RED, RESET } from '../lib/colors.ts';
import { describeFetchError } from '../lib/describe-fetch-error.ts';
import {
  getProfileManager,
  type ProfileManager,
} from '../lib/profile-manager.ts';
import { resolveRealmSecretSeed } from '../lib/prompt.ts';
import type { RealmAuthenticator } from '../lib/realm-authenticator.ts';
import { resolveRealmIdentifier } from '../lib/resolve-realm-identifier.ts';
import {
  deriveOwnerUserId,
  deriveRealmServerUrl,
  mintRealmServerToken,
} from '../lib/seed-auth.ts';

/**
 * Thin client over the realm server's `POST /_screenshot-card` endpoint
 * (contract documented at
 * `packages/realm-server/handlers/handle-screenshot-card.ts`). The CLI
 * builds the request body and passes the capture spec through verbatim —
 * the server owns validation, so new spec capabilities work here without a
 * CLI change (an unsupported field comes back as a named 400).
 *
 * Image bytes are taken from the response's inline base64 when present,
 * else downloaded from the capture's served MediaCache URL. `--url-only`
 * skips bytes entirely and prints the served URLs; note a served URL is
 * only durable for captures the server persists (canonical captures) — a
 * capture returned inline-only has `url: null` and is reported as an error
 * in that mode.
 */

const DEFAULT_MAX_WAIT_SECONDS = 120;
// Wait between busy-retries when the server's 503 carries no Retry-After.
const DEFAULT_RETRY_AFTER_SECONDS = 5;
const MANIFEST_FILE_NAME = 'screenshot-manifest.json';

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export interface CaptureManifestEntry {
  card: string;
  /** Batch capture name; null for a singular (unnamed) capture. */
  name: string | null;
  status: 'ok' | 'error';
  /** Path the image was written to (absent for --url-only and errors). */
  file?: string;
  width?: number | null;
  height?: number | null;
  deviceScaleFactor?: number | null;
  /** Hex SHA-256 of the written image bytes. */
  sha256?: string;
  /** Served MediaCache URL; null when the server returned the bytes inline only. */
  url: string | null;
  error?: string;
}

export interface ScreenshotResult {
  /** True only when every requested capture succeeded. */
  ok: boolean;
  captures: CaptureManifestEntry[];
  /** Region inventory per card URL, when the spec requested discovery. */
  regions?: Record<string, unknown>;
  /** Where the manifest JSON was written (--spec mode only). */
  manifestPath?: string;
  /** Failure that prevented any capture from being attempted. */
  error?: string;
}

export interface ScreenshotOptions {
  /** Render format: isolated, embedded, or fitted. Server-validated. */
  format?: string;
  /** Capture spec built from flags (single-card mode). Passed through verbatim. */
  captureSpec?: Record<string, unknown> | null;
  /** Path to a JSON batch spec: an entry or array of `{card, format?, captureSpec?}`. */
  specPath?: string;
  /** Directory image files (and the batch manifest) are written to. Default: cwd. */
  out?: string;
  /** Print served URLs instead of downloading image bytes. */
  urlOnly?: boolean;
  /** Realm URL containing the card(s); skips per-card realm discovery. */
  realm?: string;
  /** Total budget for busy (503) retries, milliseconds. */
  maxWaitMs?: number;
  /** Administrative auth: mint tokens locally from the realm secret seed. */
  realmSecretSeed?: string;
  /** Matrix id for the seed-minted server token (default: owner derived from the card URL). */
  asUser?: string;
  /** Realm-server base URL override (default: derived from each card's origin). */
  realmServerUrl?: string;
  /** @internal Override the ProfileManager (tests). */
  profileManager?: ProfileManager;
  /** @internal Already-constructed authenticator for realm fetches (tests). */
  authenticator?: RealmAuthenticator;
  /** @internal Fetch used for the realm-server POST (tests). */
  serverFetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** @internal Sleep between busy-retries (tests). */
  sleep?: (ms: number) => Promise<void>;
}

interface ScreenshotJob {
  card: string;
  format: string;
  captureSpec: unknown;
}

interface ResponseCapture {
  name?: string | null;
  url?: string | null;
  width?: number | null;
  height?: number | null;
  deviceScaleFactor?: number | null;
  base64?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function topLevelError(error: string): ScreenshotResult {
  return { ok: false, captures: [], error };
}

/** Capture names a job asks for, so a job-level failure can report each. */
function requestedNames(captureSpec: unknown): (string | null)[] {
  if (isPlainObject(captureSpec) && Array.isArray(captureSpec.captures)) {
    return captureSpec.captures.map((entry) =>
      isPlainObject(entry) && typeof entry.name === 'string'
        ? entry.name
        : null,
    );
  }
  return [null];
}

function slugify(value: string): string {
  let slug = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'card';
}

export async function screenshot(
  cardUrl: string | undefined,
  options: ScreenshotOptions = {},
): Promise<ScreenshotResult> {
  // Assemble the jobs: one server request (one settle) per card.
  let jobs: ScreenshotJob[];
  if (options.specPath) {
    if (cardUrl) {
      return topLevelError('Provide either a card URL or --spec, not both');
    }
    if (options.captureSpec) {
      return topLevelError(
        'Capture flags cannot be combined with --spec; put the overrides in the spec file',
      );
    }
    let parsed = readSpecFile(options.specPath);
    if ('error' in parsed) {
      return topLevelError(parsed.error);
    }
    jobs = parsed.jobs;
  } else {
    if (!cardUrl) {
      return topLevelError('A card URL is required (or pass --spec <file>)');
    }
    jobs = [
      {
        card: cardUrl,
        format: options.format ?? 'isolated',
        captureSpec: options.captureSpec ?? null,
      },
    ];
  }

  // Resolve each card identifier to an absolute, extensionless instance URL.
  for (let job of jobs) {
    let resolved = resolveRealmIdentifier(job.card, {
      profileManager: options.profileManager,
    });
    if (!resolved.ok) {
      return topLevelError(resolved.error);
    }
    let url = resolved.url.replace(/\.json$/, '');
    try {
      new URL(url);
    } catch {
      return topLevelError(`Not a valid card URL: ${job.card}`);
    }
    job.card = url;
  }

  let realmFlag = options.realm
    ? ensureTrailingSlash(options.realm)
    : undefined;

  let resolution = resolveRealmAuthenticator({
    realmUrl: realmFlag ?? jobs[0].card,
    realmSecretSeed: options.realmSecretSeed,
    profileManager: options.profileManager,
    authenticator: options.authenticator,
  });
  if (!resolution.ok) {
    return topLevelError(resolution.error);
  }
  let authenticator = resolution.authenticator;

  let serverFetch = options.serverFetch;
  if (!serverFetch) {
    if (options.realmSecretSeed) {
      // Seed mode mints one realm-server token for the whole invocation, so
      // every card must resolve to the same server origin and (absent an
      // explicit --as-user) the same derived owner — otherwise later cards
      // would be authorized as the first card's owner, and the server would
      // quietly skip the ledger identity for them (bytes returned, nothing
      // persisted).
      let base = realmFlag ?? jobs[0].card;
      let asUser: string;
      try {
        asUser = options.asUser ?? deriveOwnerUserId(base);
        let baseIdentity = `${deriveRealmServerUrl(base)} ${
          options.asUser ?? deriveOwnerUserId(base)
        }`;
        for (let job of jobs) {
          let jobIdentity = `${deriveRealmServerUrl(job.card)} ${
            options.asUser ?? deriveOwnerUserId(job.card)
          }`;
          if (jobIdentity !== baseIdentity) {
            return topLevelError(
              'Seed mode authorizes one realm owner per invocation, but the --spec cards span more than one realm server or owner. Pass --as-user for a shared identity, or split the spec by realm.',
            );
          }
        }
      } catch (e) {
        return topLevelError(
          `${e instanceof Error ? e.message : String(e)} — pass --as-user`,
        );
      }
      let token = mintRealmServerToken(options.realmSecretSeed, asUser);
      serverFetch = async (url, init) => {
        let headers = new Headers(init?.headers);
        headers.set('Authorization', token);
        return fetch(url, { ...init, headers });
      };
    } else if (resolution.mode === 'injected') {
      // Test fakes route every URL through the one injected authenticator.
      serverFetch = (url, init) => authenticator.authedRealmFetch(url, init);
    } else {
      let pm = options.profileManager ?? getProfileManager();
      serverFetch = (url, init) => pm.authedRealmServerFetch(url, init);
    }
  }

  let outDir = options.out ?? '.';
  if (!options.urlOnly) {
    mkdirSync(outDir, { recursive: true });
  }

  let usedFileNames = new Set<string>();
  let entries: CaptureManifestEntry[] = [];
  let regions: Record<string, unknown> = {};
  for (let job of jobs) {
    let jobResult = await runJob(job, {
      authenticator,
      serverFetch,
      realmFlag,
      realmServerUrl: options.realmServerUrl,
      urlOnly: options.urlOnly === true,
      outDir,
      usedFileNames,
      maxWaitMs: options.maxWaitMs ?? DEFAULT_MAX_WAIT_SECONDS * 1000,
      sleep: options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    });
    entries.push(...jobResult.entries);
    if (jobResult.regions !== undefined) {
      regions[job.card] = jobResult.regions;
    }
  }

  let result: ScreenshotResult = {
    ok: entries.every((entry) => entry.status === 'ok'),
    captures: entries,
    ...(Object.keys(regions).length ? { regions } : {}),
  };
  if (options.specPath && !options.urlOnly) {
    let manifestPath = join(outDir, MANIFEST_FILE_NAME);
    writeFileSync(manifestPath, JSON.stringify(result, null, 2));
    result.manifestPath = manifestPath;
  }
  return result;
}

function readSpecFile(
  specPath: string,
): { jobs: ScreenshotJob[] } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(specPath, 'utf8'));
  } catch (e) {
    return {
      error: `Could not read --spec file ${specPath}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
  let entries = Array.isArray(raw) ? raw : [raw];
  if (entries.length === 0) {
    return { error: `--spec file ${specPath} contains no entries` };
  }
  let jobs: ScreenshotJob[] = [];
  for (let [i, entry] of entries.entries()) {
    if (!isPlainObject(entry) || typeof entry.card !== 'string') {
      return {
        error: `--spec entry ${i} must be an object with a "card" URL`,
      };
    }
    jobs.push({
      card: entry.card,
      format: typeof entry.format === 'string' ? entry.format : 'isolated',
      captureSpec: entry.captureSpec ?? null,
    });
  }
  return { jobs };
}

interface JobContext {
  authenticator: RealmAuthenticator;
  serverFetch: (url: string, init?: RequestInit) => Promise<Response>;
  realmFlag: string | undefined;
  realmServerUrl: string | undefined;
  urlOnly: boolean;
  outDir: string;
  usedFileNames: Set<string>;
  maxWaitMs: number;
  sleep: (ms: number) => Promise<void>;
}

async function runJob(
  job: ScreenshotJob,
  ctx: JobContext,
): Promise<{ entries: CaptureManifestEntry[]; regions?: unknown }> {
  let fail = (error: string) => ({
    entries: requestedNames(job.captureSpec).map(
      (name): CaptureManifestEntry => ({
        card: job.card,
        name,
        status: 'error',
        url: null,
        error,
      }),
    ),
  });

  // The POST body needs the card's realm URL. Take it from --realm when
  // given, otherwise discover it from the `x-boxel-realm-url` header every
  // realm response carries. The probe reads the instance's source file
  // rather than the rendered card JSON so it works even when the instance
  // hasn't (or can't be) indexed — and it confirms the card exists before a
  // render is queued.
  let realmURL: string;
  if (ctx.realmFlag) {
    if (!job.card.startsWith(ctx.realmFlag)) {
      return fail(`Card is not within --realm ${ctx.realmFlag}`);
    }
    realmURL = ctx.realmFlag;
  } else {
    let response: Response;
    try {
      response = await ctx.authenticator.authedRealmFetch(`${job.card}.json`, {
        headers: { Accept: 'application/vnd.card+source' },
      });
    } catch (e) {
      return fail(describeFetchError(e));
    }
    let body = await response.text().catch(() => '');
    if (!response.ok) {
      return fail(
        `Could not load card (HTTP ${response.status}): ${body.slice(0, 200)}`,
      );
    }
    let header = response.headers.get('x-boxel-realm-url');
    if (!header) {
      return fail(
        'Could not determine the realm: response carries no x-boxel-realm-url header (pass --realm)',
      );
    }
    realmURL = ensureTrailingSlash(header);
  }

  let endpoint = `${
    ctx.realmServerUrl
      ? ensureTrailingSlash(ctx.realmServerUrl)
      : deriveRealmServerUrl(job.card)
  }_screenshot-card`;
  let body = JSON.stringify({
    data: {
      type: 'screenshot-card',
      attributes: {
        realmURL,
        cardId: job.card,
        format: job.format,
        // URLs-only needs no bytes; otherwise inline base64 is the primary
        // byte source (a capture the server does not persist has no URL).
        includeBase64: !ctx.urlOnly,
        captureSpec: job.captureSpec ?? null,
      },
    },
  });

  // The server answers 503 + Retry-After when the render outlasts its
  // bounded sync wait; a canonical capture still lands in the MediaCache, so
  // the retry is cheap. Keep retrying within the budget.
  let started = Date.now();
  let response: Response;
  for (;;) {
    try {
      response = await ctx.serverFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.api+json',
          Accept: 'application/vnd.api+json',
        },
        body,
      });
    } catch (e) {
      return fail(describeFetchError(e));
    }
    if (response.status !== 503) {
      break;
    }
    await response.text().catch(() => '');
    let retryAfterSeconds = Number.parseInt(
      response.headers.get('retry-after') ?? '',
      10,
    );
    if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
      retryAfterSeconds = DEFAULT_RETRY_AFTER_SECONDS;
    }
    let elapsed = Date.now() - started;
    if (elapsed + retryAfterSeconds * 1000 > ctx.maxWaitMs) {
      return fail(
        `Server busy: gave up after ${Math.round(
          elapsed / 1000,
        )}s (raise --max-wait or retry later)`,
      );
    }
    // Progress goes to stderr: stdout is the --json / --url-only contract
    // stream, and a busy retry mid-batch must not corrupt it.
    console.error(
      `Server busy; retrying ${job.card} in ${retryAfterSeconds}s…`,
    );
    await ctx.sleep(retryAfterSeconds * 1000);
  }

  let text = await response.text().catch(() => '');
  if (!response.ok) {
    return fail(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  let attrs: Record<string, unknown> | undefined;
  try {
    let doc = JSON.parse(text);
    attrs = isPlainObject(doc?.data?.attributes)
      ? doc.data.attributes
      : undefined;
  } catch {
    return fail('Invalid JSON response from server');
  }
  if (!attrs) {
    return fail('Malformed response: missing data.attributes');
  }
  if (attrs.status !== 'ready') {
    return fail(
      attrs.error
        ? String(attrs.error)
        : `Capture failed (status: ${String(attrs.status ?? 'unknown')})`,
    );
  }

  // A ready response can omit `captures` when the render engine returned
  // only the singular mirror fields (base64/width/height) — the endpoint's
  // own suite exercises this stub-engine shape. Such a capture was not
  // persisted, so it carries no served URL; synthesize the one entry from
  // the mirror.
  let captures: ResponseCapture[] = Array.isArray(attrs.captures)
    ? (attrs.captures as ResponseCapture[])
    : attrs.base64 != null || attrs.width != null
      ? [
          {
            name: null,
            url: null,
            width: (attrs.width as number | undefined) ?? null,
            height: (attrs.height as number | undefined) ?? null,
            deviceScaleFactor: null,
            base64: attrs.base64 as string | undefined,
          },
        ]
      : [];
  if (captures.length === 0) {
    return fail('Response contained no captures');
  }

  let entries: CaptureManifestEntry[];
  if (ctx.urlOnly) {
    entries = captures.map((capture) =>
      capture.url
        ? {
            card: job.card,
            name: capture.name ?? null,
            status: 'ok' as const,
            url: capture.url,
            width: capture.width ?? null,
            height: capture.height ?? null,
            deviceScaleFactor: capture.deviceScaleFactor ?? null,
          }
        : {
            card: job.card,
            name: capture.name ?? null,
            status: 'error' as const,
            url: null,
            error:
              'No served URL for this capture: the server returns URLs only for captures it persists (canonical specs)',
          },
    );
  } else {
    let contentType =
      typeof attrs.contentType === 'string' ? attrs.contentType : 'image/png';
    let extension = EXTENSION_BY_CONTENT_TYPE[contentType] ?? 'png';
    let localPath = job.card.startsWith(realmURL)
      ? job.card.slice(realmURL.length)
      : new URL(job.card).pathname.replace(/^\//, '');
    entries = [];
    for (let capture of captures) {
      entries.push(
        await writeCapture(job, capture, {
          ctx,
          baseName: slugify(localPath),
          extension,
        }),
      );
    }
  }

  return {
    entries,
    ...(attrs.regions !== undefined ? { regions: attrs.regions } : {}),
  };
}

async function writeCapture(
  job: ScreenshotJob,
  capture: ResponseCapture,
  {
    ctx,
    baseName,
    extension,
  }: { ctx: JobContext; baseName: string; extension: string },
): Promise<CaptureManifestEntry> {
  let name = capture.name ?? null;
  let common = {
    card: job.card,
    name,
    url: capture.url ?? null,
    width: capture.width ?? null,
    height: capture.height ?? null,
    deviceScaleFactor: capture.deviceScaleFactor ?? null,
  };

  let bytes: Buffer | undefined;
  if (typeof capture.base64 === 'string' && capture.base64.length > 0) {
    bytes = Buffer.from(capture.base64, 'base64');
  } else if (capture.url) {
    let response: Response;
    try {
      response = await ctx.authenticator.authedRealmFetch(capture.url);
    } catch (e) {
      return { ...common, status: 'error', error: describeFetchError(e) };
    }
    if (!response.ok) {
      await response.text().catch(() => '');
      return {
        ...common,
        status: 'error',
        error: `Download failed (HTTP ${response.status}): ${capture.url}`,
      };
    }
    bytes = Buffer.from(await response.arrayBuffer());
  } else {
    return {
      ...common,
      status: 'error',
      error: 'Capture carried neither image data nor a served URL',
    };
  }

  let stem = name ? `${baseName}--${slugify(name)}` : baseName;
  let fileName = `${stem}.${extension}`;
  for (let counter = 2; ctx.usedFileNames.has(fileName); counter++) {
    fileName = `${stem}-${counter}.${extension}`;
  }
  ctx.usedFileNames.add(fileName);
  let filePath = join(ctx.outDir, fileName);
  writeFileSync(filePath, bytes);

  return {
    ...common,
    status: 'ok',
    file: filePath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

interface ScreenshotCliOptions {
  format?: string;
  viewport?: { width: number; height: number };
  envelope?: { width: number; height: number };
  dsf?: number;
  clip?: { x: number; y: number; width: number; height: number };
  target?: string;
  fullPage?: boolean;
  out?: string;
  spec?: string;
  urlOnly?: boolean;
  realm?: string;
  maxWait?: number;
  realmSecretSeed?: boolean;
  asUser?: string;
  json?: boolean;
}

export function captureSpecFromFlags(
  opts: ScreenshotCliOptions,
): Record<string, unknown> | null {
  let spec: Record<string, unknown> = {};
  if (opts.viewport) {
    spec.viewport = opts.viewport;
  }
  if (opts.envelope) {
    spec.envelope = opts.envelope;
  }
  if (opts.dsf !== undefined) {
    spec.deviceScaleFactor = opts.dsf;
  }
  if (opts.clip) {
    spec.clip = opts.clip;
  }
  if (opts.target) {
    spec.target = opts.target;
  }
  if (opts.fullPage) {
    spec.fullPage = true;
  }
  return Object.keys(spec).length ? spec : null;
}

function parseDimensions(flag: string): (value: string) => {
  width: number;
  height: number;
} {
  return (value: string) => {
    let match = /^(\d+)x(\d+)$/i.exec(value.trim());
    if (!match) {
      throw new Error(`${flag} must be WxH (e.g. 800x600)`);
    }
    return { width: Number(match[1]), height: Number(match[2]) };
  };
}

function parseDeviceScaleFactor(value: string): number {
  let n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('--dsf must be a positive number');
  }
  return n;
}

function parseClip(value: string): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  let parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error('--clip must be x,y,w,h (e.g. 0,0,400,300)');
  }
  let [x, y, width, height] = parts;
  return { x, y, width, height };
}

function parseMaxWait(value: string): number {
  let n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0 || String(n) !== value.trim()) {
    throw new Error('--max-wait must be a non-negative integer (seconds)');
  }
  return n;
}

export function registerScreenshotCommand(program: Command): void {
  program
    .command('screenshot')
    .description(
      'Capture screenshots of a card via the realm server: writes image files (or prints served URLs) plus a per-capture manifest',
    )
    .argument(
      '[card-url]',
      'Card instance URL or @cardstack/<realm>/<path> identifier (omit when using --spec)',
    )
    .option(
      '--format <format>',
      'Render format: isolated, embedded, or fitted (fitted requires --envelope)',
      'isolated',
    )
    .option(
      '--viewport <WxH>',
      'Render viewport in CSS pixels, e.g. 800x600',
      parseDimensions('--viewport'),
    )
    .option(
      '--envelope <WxH>',
      'Parent box a fitted card lays out into, in CSS pixels, e.g. 400x300',
      parseDimensions('--envelope'),
    )
    .option(
      '--dsf <n>',
      'Device scale factor (e.g. 2 doubles the physical pixel density)',
      parseDeviceScaleFactor,
    )
    .option(
      '--clip <x,y,w,h>',
      'Capture only this CSS-pixel rectangle',
      parseClip,
    )
    .option(
      '--target <selector>',
      'Capture the element matching this CSS selector (requires a realm server that supports target captures; older servers reject it with a named 400)',
    )
    .option('--full-page', 'Capture the full scrollable page height')
    .option(
      '--out <dir>',
      'Directory to write image files into (default: current directory)',
    )
    .option(
      '--spec <file>',
      'JSON batch spec — an entry or array of {card, format?, captureSpec?}; one request per card, writes screenshot-manifest.json into --out',
    )
    .option(
      '--url-only',
      'Print served screenshot URLs without downloading image bytes',
    )
    .option(
      '--realm <realm-url>',
      'Realm URL containing the card (skips realm auto-discovery)',
    )
    .option(
      '--max-wait <seconds>',
      'Total time to keep retrying while the server is busy',
      parseMaxWait,
      DEFAULT_MAX_WAIT_SECONDS,
    )
    .option(
      '--realm-secret-seed',
      'Administrative auth: prompt for a realm secret seed and mint tokens locally instead of using a Matrix profile (env: BOXEL_REALM_SECRET_SEED)',
    )
    .option(
      '--as-user <matrix-id>',
      'Matrix id to authorize as in seed mode (defaults to the owner derived from the card URL)',
    )
    .option('--json', 'Output the capture manifest as JSON')
    .action(async (cardUrl: string | undefined, opts: ScreenshotCliOptions) => {
      try {
        let realmSecretSeed = await resolveRealmSecretSeed(
          opts.realmSecretSeed === true,
        );
        let result = await screenshot(cardUrl, {
          format: opts.format,
          captureSpec: captureSpecFromFlags(opts),
          specPath: opts.spec,
          out: opts.out,
          urlOnly: opts.urlOnly,
          realm: opts.realm,
          maxWaitMs: (opts.maxWait ?? DEFAULT_MAX_WAIT_SECONDS) * 1000,
          realmSecretSeed,
          asUser: opts.asUser,
        });

        if (opts.json) {
          cliLog.output(JSON.stringify(result, null, 2));
          if (!result.ok) {
            process.exit(1);
          }
          return;
        }

        if (result.error) {
          console.error(`${FG_RED}Error:${RESET} ${result.error}`);
          process.exit(1);
        }
        for (let entry of result.captures) {
          let label = entry.name ? `${entry.card} [${entry.name}]` : entry.card;
          if (entry.status !== 'ok') {
            console.error(`${FG_RED}✗ ${label}:${RESET} ${entry.error}`);
          } else if (opts.urlOnly) {
            cliLog.output(entry.url!);
          } else {
            let dims =
              entry.width != null && entry.height != null
                ? ` (${entry.width}×${entry.height})`
                : '';
            console.log(
              `${FG_GREEN}✓${RESET} ${label} → ${FG_CYAN}${entry.file}${RESET}${dims}`,
            );
          }
        }
        if (result.manifestPath) {
          console.log(`Manifest: ${FG_CYAN}${result.manifestPath}${RESET}`);
        }
        if (!result.ok) {
          process.exit(1);
        }
      } catch (err) {
        let message = err instanceof Error ? err.message : String(err);
        console.error(`${FG_RED}Error:${RESET} ${message}`);
        process.exit(1);
      }
    });
}
