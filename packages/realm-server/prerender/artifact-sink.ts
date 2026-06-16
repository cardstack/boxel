// Durable S3 sink for the prerender profiler's heavyweight artifacts —
// full `.cpuprofile`s, CDP trace streams, and heap-allocation profiles.
//
// Why this module exists:
//
//   The CPU profiler (`cpu-profiler.ts`) can only afford to log a compact
//   top-N self-time summary: a render that wedges for a ~40-minute
//   single-realm reindex produces full artifacts that run to GBs, far past
//   what a log line can carry. Those full artifacts are what load into
//   Chrome DevTools / speedscope / Perfetto for the deep analysis a
//   summary can't support. The prerender task renders untrusted card code
//   and is deliberately segregated from the realm-server, so it can't
//   reuse the realm-server's EFS; this sink writes to its own provisioned
//   S3 bucket instead.
//
// Operating contract:
//
//   * Entirely opt-in and best-effort. With no bucket configured the sink
//     is inert; every upload swallows its own errors so a failed flush can
//     never perturb a render.
//   * One artifact is flushed per render (the callers hand over a finished
//     blob or a live stream), so a crash loses at most the in-flight
//     render's data — never a whole session's.
//   * A per-session byte budget bounds total volume on top of the bucket's
//     lifecycle expiry: once the process has written its budget, further
//     uploads are declined (in-flight ones are allowed to finish, so the
//     budget is a soft ceiling, never a source of truncated/!invalid
//     blobs).
//
// In ECS the bucket write grant rides on the task role, which the AWS SDK
// resolves automatically from the container credentials endpoint — there
// are no access keys or profiles to configure here.

import type { Readable } from 'stream';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { logger } from '@cardstack/runtime-common';

const log = logger('prerenderer');

// Default per-session byte budget when `PRERENDER_PROFILE_MAX_SESSION_BYTES`
// is unset or not a positive integer. Generous enough to capture a useful
// slice of a multi-GB reindex session while still bounding cost alongside
// the bucket's lifecycle expiry; an operator targeting a long session can
// raise it.
const DEFAULT_MAX_SESSION_BYTES = 5 * 1024 * 1024 * 1024; // 5 GiB
// Fallback S3 region. Both deployed environments live in us-east-1; an
// operator can override per-process without a code change.
const DEFAULT_REGION = 'us-east-1';

// The artifact formats this sink carries. Each maps to a file suffix the
// usual tools recognise: `.cpuprofile` (Chrome DevTools / speedscope),
// `.trace.json` (Chrome tracing / Perfetto), `.heapprofile` (DevTools
// allocation-sampling view).
export type ArtifactKind = 'cpuprofile' | 'trace' | 'heap' | 'v8log';

const SUFFIX_BY_KIND: Record<ArtifactKind, string> = {
  cpuprofile: 'cpuprofile',
  trace: 'trace.json',
  heap: 'heapprofile',
  // Raw V8 `--prof` tick log (the renderer's `isolate-…-prerender-v8-prof`
  // file), uploaded as-is and symbolized offline with `node --prof-process`.
  // This is the one capture that survives a hard synchronous CPU peg: the
  // kernel SIGPROF sampler writes it from a separate thread, so it lands even
  // when the main thread is too pegged to service CDP — but it's too large to
  // `--prof-process` inside the render-timeout budget, so we ship the bytes.
  v8log: 'v8log',
};

// The render-identifying fields that key an artifact. All but `kind` are
// optional: an on-demand render carries no indexing `jobId`, and a render
// that never resolved an affinity still produces a sensibly-keyed blob.
export interface ArtifactKeyParts {
  // Realm being rendered (recovered from the render's affinity key).
  realm?: string;
  // Indexing job id — set only for indexer-driven visits.
  jobId?: string;
  // Card / module url being rendered.
  card?: string;
  // Render step / pass (e.g. `card isolated/0`, `screenshot png`).
  step?: string;
  kind: ArtifactKind;
}

export interface ArtifactUpload extends ArtifactKeyParts {
  // A finished blob (cpuprofile / heap profile) or a live stream (the CDP
  // trace, drained as it is produced). Streams are uploaded with the SDK's
  // managed multipart upload, so memory stays bounded regardless of size.
  body: Buffer | Readable;
  contentType?: string;
}

// ---------------------------------------------------------------------------
// Configuration — read at call time (never frozen at module load) so tests
// and operators can flip env without a stale process snapshot, mirroring
// `cpu-profiler.ts`.
// ---------------------------------------------------------------------------

function artifactBucket(): string | undefined {
  let raw = process.env.PRERENDER_ARTIFACTS_BUCKET;
  let bucket = typeof raw === 'string' ? raw.trim() : '';
  return bucket.length > 0 ? bucket : undefined;
}

function artifactEnv(): string {
  let raw = process.env.PRERENDER_ARTIFACTS_ENV;
  let env = typeof raw === 'string' ? raw.trim() : '';
  return env.length > 0 ? env : 'unknown';
}

function artifactRegion(): string {
  return (
    process.env.PRERENDER_ARTIFACTS_REGION?.trim() ||
    process.env.AWS_REGION?.trim() ||
    DEFAULT_REGION
  );
}

// The configured per-session byte budget, or the built-in default when the
// value is unset / non-positive / unparseable. Exported for the unit tests
// and for callers that want to short-circuit a capture before doing CDP
// work.
export function getMaxSessionBytes(): number {
  let raw = process.env.PRERENDER_PROFILE_MAX_SESSION_BYTES;
  if (typeof raw === 'string') {
    let parsed = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_MAX_SESSION_BYTES;
}

// True when a destination bucket is configured. The capture paths gate on
// this before issuing any CDP calls, so an unconfigured sink costs nothing.
export function artifactSinkEnabled(): boolean {
  return artifactBucket() !== undefined;
}

// ---------------------------------------------------------------------------
// Per-mode capture flags. Each heavyweight capture is gated by both the
// affinity trigger (one deliberately-targeted realm) AND its own flag, so a
// realm can be summarised in logs without paying to also persist a full
// blob. Read at call time; absent / anything but "true" leaves the mode off.
// ---------------------------------------------------------------------------

function flagEnabled(name: string): boolean {
  return process.env[name]?.trim() === 'true';
}

export function shouldCaptureCpuProfile(): boolean {
  return flagEnabled('PRERENDER_PROFILE_CPUPROFILE');
}

export function shouldCaptureTrace(): boolean {
  return flagEnabled('PRERENDER_PROFILE_TRACE');
}

export function shouldCaptureHeap(): boolean {
  return flagEnabled('PRERENDER_PROFILE_HEAP');
}

// True when the sink is configured AND at least one heavyweight capture is
// enabled — the cheap gate the per-render orchestration checks before
// touching CDP.
export function anyArtifactCaptureEnabled(): boolean {
  return (
    artifactSinkEnabled() &&
    (shouldCaptureCpuProfile() || shouldCaptureTrace() || shouldCaptureHeap())
  );
}

// ---------------------------------------------------------------------------
// S3 key construction (pure).
// ---------------------------------------------------------------------------

// `env/realm/jobId/card/step/<timestamp>-<seq>.<suffix>`. Every dynamic
// segment is reduced to a filesystem-/key-safe token so the object browses
// cleanly and carries no host origin. `seq` disambiguates two artifacts
// that would otherwise collide within the same millisecond.
export function buildArtifactKey(
  parts: ArtifactKeyParts,
  now: Date,
  seq: number,
): string {
  let timestamp = now.toISOString().replace(/[:.]/g, '-');
  let segments = [
    sanitizeSegment(artifactEnv()),
    sanitizeSegment(parts.realm) || 'no-realm',
    sanitizeSegment(parts.jobId) || 'no-job',
    sanitizeSegment(parts.card) || 'no-card',
    sanitizeSegment(parts.step) || 'no-step',
    `${timestamp}-${seq}.${SUFFIX_BY_KIND[parts.kind]}`,
  ];
  return segments.join('/');
}

// Reduces an arbitrary value (url, job id, step label) to a single safe key
// segment: the protocol/host noise is dropped, every run of unsafe
// characters collapses to a dash, and the result is length-capped so a long
// url can't blow out the key. Returns '' for empty/whitespace input.
function sanitizeSegment(value: string | undefined): string {
  if (!value) {
    return '';
  }
  let trimmed = value.trim().replace(/^https?:\/\//, '');
  let safe = trimmed
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
  return safe;
}

// ---------------------------------------------------------------------------
// Upload — best-effort, never throws.
// ---------------------------------------------------------------------------

let client: S3Client | undefined;
function getClient(): S3Client {
  if (!client) {
    client = new S3Client({ region: artifactRegion() });
  }
  return client;
}

// Process-lifetime ("session") accounting. The process is one prerender
// task; the budget bounds how much it writes across all renders it serves.
let sessionBytesUsed = 0;
let uploadSeq = 0;
let budgetExhaustedLogged = false;

// Uploads one artifact. Resolves once the object is durable in S3 (so a
// per-render `await` genuinely persists before the next render), or sooner
// if the sink is disabled / the budget is spent / the upload fails — none
// of which ever throw or reject. Declines (does not truncate) once the
// session budget is reached, so it never produces an invalid blob.
export async function uploadArtifact(upload: ArtifactUpload): Promise<void> {
  let bucket = artifactBucket();
  if (!bucket) {
    return;
  }
  if (sessionBytesUsed >= getMaxSessionBytes()) {
    if (!budgetExhaustedLogged) {
      budgetExhaustedLogged = true;
      log.warn(
        `artifact-sink session byte budget (${getMaxSessionBytes()}) reached; ` +
          `declining further artifact uploads for this process`,
      );
    }
    return;
  }

  let key = buildArtifactKey(upload, new Date(), uploadSeq++);
  let loaded = 0;
  try {
    let managed = new Upload({
      client: getClient(),
      params: {
        Bucket: bucket,
        Key: key,
        Body: upload.body,
        ContentType: upload.contentType ?? 'application/json',
      },
    });
    managed.on('httpUploadProgress', (progress) => {
      if (typeof progress.loaded === 'number') {
        loaded = progress.loaded;
      }
    });
    await managed.done();
    sessionBytesUsed += loaded;
    log.info(
      `artifact-sink uploaded ${upload.kind} key=${key} bytes=${loaded} ` +
        `sessionBytes=${sessionBytesUsed}/${getMaxSessionBytes()}`,
    );
  } catch (e) {
    // Best-effort: a failed flush is a missing diagnostic, not a render
    // failure. Count nothing against the budget.
    log.warn(`artifact-sink failed to upload ${upload.kind} key=${key}:`, e);
  }
}

// Test-only: reset the process-lifetime accounting between cases.
export function __resetArtifactSinkSessionForTests(): void {
  sessionBytesUsed = 0;
  uploadSeq = 0;
  budgetExhaustedLogged = false;
}
