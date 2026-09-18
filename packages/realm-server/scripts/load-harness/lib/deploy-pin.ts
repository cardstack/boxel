// Whether the deployment under test held still for as long as the run took to
// measure it.
//
// A set of numbers describes one build of one fleet. A non-production
// deployment moves on its own schedule, and a window long enough to measure
// anything is long enough for a deploy to land inside it. A run that straddles
// one is not a slow run or a noisy one — it is two runs averaged together, and
// a moved number cannot be told from a moved deployment. The check has to be
// mechanical, because the operator who would remember it is the one watching
// the run.
//
// Two things are readable over plain HTTP, with no credentials and no AWS
// session, which is what lets this run on every target the harness points at:
//
//   - THE HOST BUILD. The realm server serves the host app's boot document,
//     and that document names the entry bundle a browser will load
//     (`assets/main-<hash>.js`) and carries the host's own build version in
//     its config meta (`0.0.0+<sha>`). Either one moving means the client half
//     of any measurement changed underneath it.
//
//   - WHICH REPLICA ANSWERED. `X-ECS-Container-Metadata-URI-v4` carries the
//     answering container's id. A fleet that turned over mid-run is then
//     visible even when the task definition did not change, and a replaced
//     task is a cold one — its own reason to discard the window, and the way
//     three runs were lost to cold containers before this check existed.
//
// The realm server fetches the boot document once per process and caches it
// for that process's life, so what a replica serves is pinned to when that
// replica started. Two replicas can therefore serve two different host builds
// at the same moment, and a browser gets whichever one answers. That is why a
// reading is a set of replicas rather than one answer, and why the probes in a
// wave are concurrent: undici hands a request to an already-free socket in
// preference to opening another, so sequential probes ask one replica the same
// question several times.

import { ensureTrailingSlash } from './common.ts';

// What one replica serves. Both members are optional because a target that
// answers with something other than a built boot document — a dev server, an
// error page — must leave the run unpinned rather than pinned to a guess.
export interface ServedBuild {
  // The entry module the boot document loads, by filename.
  bundle: string | undefined;
  // The host's own build version from the config meta.
  hostVersion: string | undefined;
}

export interface FleetReading {
  // What each answering replica served, keyed by container id. A replica that
  // answered none of the probes is absent, so this is what was SEEN and never
  // the whole fleet.
  replicas: Map<string, ServedBuild>;
  probes: number;
  responses: number;
}

// The key a response with no container id is filed under. A deployment that
// identifies no replicas — a local stack, anything not on ECS — collapses into
// this single entry, so its readings compare builds and never turnover.
export const UNIDENTIFIED_REPLICA = 'unidentified';

// `_standby` is the cheapest document that names the bundle: it serves the
// host app like any card URL, takes no authentication, and reaches no realm.
const BOOT_PATH = '_standby';

export function bootDocumentUrl(realmServerUrl: string): string {
  return new URL(BOOT_PATH, ensureTrailingSlash(realmServerUrl)).href;
}

// The realm server negotiates on Accept, and only a request that asks for HTML
// is answered with the host app. Asking for anything else reaches a different
// handler and reports a fleet with no build at all.
const BOOT_HEADERS = { Accept: 'text/html' };

export function parseServedBuild(html: string): ServedBuild {
  return { bundle: entryBundle(html), hostVersion: hostVersion(html) };
}

function entryBundle(html: string): string | undefined {
  for (let tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    if (!/\btype="module"/i.test(tag)) {
      continue;
    }
    let src = /\bsrc="([^"]+)"/i.exec(tag)?.[1];
    if (!src) {
      continue;
    }
    // The assets usually live on a different origin than the document, so the
    // src is absolute; the filename is the part that identifies the build.
    return src.split(/[?#]/)[0].split('/').pop() || undefined;
  }
  return undefined;
}

function hostVersion(html: string): string | undefined {
  // Attribute order is the server's own: it rewrites this tag by matching
  // `name=` followed by `content=`, so a document whose order differs is not
  // one this server produced.
  let encoded =
    /<meta[^>]+name="@cardstack\/host\/config\/environment"[^>]+content="([^"]*)"/i.exec(
      html,
    )?.[1];
  if (!encoded) {
    return undefined;
  }
  try {
    let config = JSON.parse(decodeURIComponent(encoded));
    let version = config?.APP?.version;
    return typeof version === 'string' && version ? version : undefined;
  } catch {
    return undefined;
  }
}

export function replicaIdFromHeaders(headers: Headers): string | undefined {
  // The header carries the task metadata endpoint, `…/v4/<container id>`,
  // which is reachable only from inside the container. The id is the useful
  // part: it changes when the task is replaced, which a deploy always does and
  // a recycle does too.
  let uri = headers.get('x-ecs-container-metadata-uri-v4');
  if (!uri) {
    return undefined;
  }
  return uri.split('/').filter(Boolean).pop() || undefined;
}

export interface ReadFleetOptions {
  fetchImpl?: typeof fetch;
  waveSize?: number;
  maxWaves?: number;
  timeoutMs?: number;
}

// Probe the fleet in concurrent waves until a wave meets nobody new. Widening
// the sample matters in both directions: a replica missed at the start reads
// as an arrival at the close, and a replica missed at the close hides a build
// that a browser could still be served.
export async function readFleet(
  url: string,
  {
    fetchImpl = fetch,
    waveSize = 4,
    maxWaves = 4,
    timeoutMs = 10000,
  }: ReadFleetOptions = {},
): Promise<FleetReading> {
  let replicas = new Map<string, ServedBuild>();
  let probes = 0;
  let responses = 0;
  for (let wave = 0; wave < maxWaves; wave++) {
    let known = replicas.size;
    let results = await Promise.all(
      Array.from({ length: waveSize }, () =>
        probeOnce(url, fetchImpl, timeoutMs),
      ),
    );
    probes += waveSize;
    for (let result of results) {
      if (!result) {
        continue;
      }
      responses++;
      replicas.set(result.replicaId ?? UNIDENTIFIED_REPLICA, result.build);
    }
    // Stop once the fan-out stops discovering. The first wave is exempt so a
    // target that answered nothing gets a second chance rather than being
    // reported as unreachable on one unlucky moment.
    if (replicas.size === known && wave > 0) {
      break;
    }
  }
  return { replicas, probes, responses };
}

async function probeOnce(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ replicaId: string | undefined; build: ServedBuild } | undefined> {
  try {
    let response = await fetchImpl(url, {
      headers: BOOT_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    let html = await response.text();
    if (!response.ok) {
      return undefined;
    }
    return {
      replicaId: replicaIdFromHeaders(response.headers),
      build: parseServedBuild(html),
    };
  } catch {
    // An unreachable target is a reading with no responses, which the caller
    // reports; it is not a reason to end a run that has already been paid for.
    return undefined;
  }
}

// A reading is only a pin if it identifies the build. A target that answers
// with something other than a built boot document leaves the run unpinned, and
// saying so is the whole value — a number quoted as one build's has to be one.
export function pinIsReadable(reading: FleetReading): boolean {
  return [...reading.replicas.values()].some(
    (build) => build.bundle !== undefined || build.hostVersion !== undefined,
  );
}

function buildLabel({ bundle, hostVersion: version }: ServedBuild): string {
  return `${bundle ?? 'unknown bundle'} (${version ?? 'unknown version'})`;
}

function distinctBuilds(reading: FleetReading): string[] {
  return [...new Set([...reading.replicas.values()].map(buildLabel))].sort();
}

export function describeFleet(reading: FleetReading, url: string): string {
  if (reading.responses === 0) {
    return (
      `Deploy pin: ${url} answered none of ${reading.probes} probes, so this run ` +
      `is not pinned to a build.`
    );
  }
  let replicas = `${reading.replicas.size} replica${reading.replicas.size === 1 ? '' : 's'}`;
  if (!pinIsReadable(reading)) {
    return (
      `Deploy pin: ${replicas} answered, none with a boot document naming a ` +
      `host build, so this run is not pinned to one.`
    );
  }
  return (
    `Deploy pin: host build ${distinctBuilds(reading).join(' and ')}, ` +
    `${replicas} over ${reading.probes} probes.`
  );
}

// Checked before a run starts, so a fleet already mid-rollout costs a probe
// rather than the whole measurement window.
export function fleetStraddle(reading: FleetReading): string[] {
  let builds = distinctBuilds(reading);
  if (builds.length < 2) {
    return [];
  }
  return [
    `the fleet is already serving ${builds.length} host builds at once — ` +
      `${builds.join(' and ')} — so which one a request gets depends on ` +
      `which replica answers it`,
  ];
}

// Checked at the close. Each finding is a reason the numbers describe more
// than one deployment, stated so a reader can see what it rests on.
export function fleetDrift(
  before: FleetReading,
  after: FleetReading,
): string[] {
  if (after.responses === 0) {
    return [
      `nothing answered the closing probe (${after.probes} attempts), so the ` +
        `deployment cannot be confirmed to have held still`,
    ];
  }
  let findings: string[] = [];
  let seenBefore = new Set(distinctBuilds(before));
  let arrivedBuilds = distinctBuilds(after).filter((b) => !seenBefore.has(b));
  if (arrivedBuilds.length) {
    findings.push(
      `the host build moved: ${[...seenBefore].join(' and ')} at the start, ` +
        `${arrivedBuilds.join(' and ')} at the close`,
    );
  }
  let arrivedReplicas = [...after.replicas.keys()].filter(
    (id) => id !== UNIDENTIFIED_REPLICA && !before.replicas.has(id),
  );
  if (arrivedReplicas.length) {
    findings.push(
      `${arrivedReplicas.length} replica${arrivedReplicas.length === 1 ? '' : 's'} ` +
        `answered the closing probe that had not answered at the start, so a ` +
        `task was replaced or added and part of this window was served cold ` +
        `(both probes sample the fleet, so a replica that answered neither is ` +
        `invisible to this check)`,
    );
  }
  return findings;
}

// One line for the run summary, so a quoted number carries the build it
// describes — or says plainly that it carries none.
export function describePin(before: FleetReading, after: FleetReading): string {
  if (!pinIsReadable(before)) {
    return (
      `build:    not pinned — no boot document named a host build, so these ` +
      `numbers are not tied to one`
    );
  }
  return (
    `build:    ${distinctBuilds(before).join(' and ')}, unchanged across the ` +
    `run (${before.replicas.size} replicas at the start, ${after.replicas.size} at the close)`
  );
}
