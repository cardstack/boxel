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
//   - WHICH REPLICAS ANSWERED. `X-ECS-Container-Metadata-URI-v4` carries the
//     answering container's id. A fleet that turned over mid-run is then
//     visible even when the task definition did not change, and a replaced
//     task is a cold one, which invalidates the window on its own.
//
// The realm server fetches the boot document once per process and caches it
// for that process's life, so what a replica serves is pinned to when that
// replica started. Two replicas can therefore serve two different host builds
// at the same moment, and a browser gets whichever one answers. A reading is
// for that reason a set of replicas and a set of builds, never one answer.
//
// READING THE FLEET IS A SAMPLING PROBLEM, and the sampling decides what the
// comparison is allowed to conclude. A reading that missed a replica at the
// start reports it as an arrival at the close; one that misses a replica at
// the close reports it as a departure. Both would refuse a run that nothing
// happened to. Two properties keep the sample honest — probes within a wave
// run concurrently, and every probe opens its own connection — and the
// closing reading additionally keeps probing while any replica the opening
// one saw has yet to answer.

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
  // Which replicas answered at all, by container id — including the ones whose
  // answer was unusable, because a replica that says "502" has still said it is
  // there, and dropping it would report it as departed. A replica that answered
  // no probe is absent, so this is what was SEEN and never the whole fleet.
  replicas: Set<string>;
  // Every distinct build observed, keyed by label, and held apart from replica
  // identity for two reasons: a target that identifies no replicas files every
  // response under one key, where builds would overwrite one another until only
  // the last probe's survived; and an answer can identify its replica without
  // carrying a usable document.
  builds: Map<string, ServedBuild>;
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

const BOOT_HEADERS = {
  // The realm server negotiates on Accept, and only a request that asks for
  // HTML is answered with the host app. Asking for anything else reaches a
  // different handler and reports a fleet with no build at all.
  Accept: 'text/html',
  // Every probe opens its own connection, which is what makes a wave a
  // fan-out. undici hands a request to an already-free socket in preference
  // to opening another, and a wave's sockets are free by the time the next
  // wave is issued — so without this a reading converges on the handful of
  // connections its first wave opened, however many waves follow, and misses
  // most of a fleet larger than one wave. Measured against a server that
  // reports the socket each request arrived on: three waves of four reach 4,
  // 5, 5 distinct sockets with keep-alive, and 4, 8, 12 without it.
  Connection: 'close',
};

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
  // Replicas a previous reading saw. The closing reading passes the opening
  // one's, so a replica is called departed only after this reading has gone
  // looking for it — the difference between evidence and an unlucky sample.
  expect?: Iterable<string>;
}

// Probe in concurrent waves until a wave discovers nothing new and every
// expected replica has answered.
export async function readFleet(
  url: string,
  {
    fetchImpl = fetch,
    waveSize = 4,
    maxWaves = 4,
    timeoutMs = 10000,
    expect = [],
  }: ReadFleetOptions = {},
): Promise<FleetReading> {
  let expected = [...expect].filter((id) => id !== UNIDENTIFIED_REPLICA);
  let replicas = new Set<string>();
  let builds = new Map<string, ServedBuild>();
  for (let wave = 0, probes = 0, responses = 0; ; ) {
    let knownReplicas = replicas.size;
    let knownBuilds = builds.size;
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
      replicas.add(result.replicaId ?? UNIDENTIFIED_REPLICA);
      // Only a document that named something goes in. A 200 carrying an error
      // page parses to a build with nothing in it, and recording that would
      // put a second "build" beside the real one: a straddle at the start, or
      // a build that moved at the close, from a fleet that never changed.
      if (result.build && identifiesBuild(result.build)) {
        builds.set(buildLabel(result.build), result.build);
      }
    }
    wave++;
    let stillLooking = expected.some((id) => !replicas.has(id));
    let discovered =
      replicas.size !== knownReplicas || builds.size !== knownBuilds;
    // Stop once the fan-out has stopped discovering and has met everyone it
    // came looking for. The first wave is exempt from the first condition so a
    // target that answered nothing gets a second chance rather than being
    // called unreachable on one unlucky moment.
    if (wave >= maxWaves || (!discovered && !stillLooking && wave > 1)) {
      return { replicas, builds, probes, responses };
    }
  }
}

async function probeOnce(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<
  { replicaId: string | undefined; build: ServedBuild | undefined } | undefined
> {
  try {
    let response = await fetchImpl(url, {
      headers: BOOT_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    let html = await response.text();
    // A replica that answers with an error has still said it is there, and its
    // id is the whole of what the fleet comparison needs from it. Only the
    // document is unusable, so only the build is dropped.
    return {
      replicaId: replicaIdFromHeaders(response.headers),
      build: response.ok ? parseServedBuild(html) : undefined,
    };
  } catch {
    // An unreachable target is a reading with no responses, which the caller
    // reports; it is not a reason to end a run that has already been paid for.
    return undefined;
  }
}

function identifiesBuild({ bundle, hostVersion }: ServedBuild): boolean {
  return bundle !== undefined || hostVersion !== undefined;
}

// A reading is only a pin if it identifies the build. A target that answers
// with something other than a built boot document leaves the run unpinned, and
// saying so is the whole value — a number quoted as one build's has to be one.
export function pinIsReadable(reading: FleetReading): boolean {
  return reading.builds.size > 0;
}

export function buildLabel({
  bundle,
  hostVersion: version,
}: ServedBuild): string {
  return `${bundle ?? 'unknown bundle'} (${version ?? 'unknown version'})`;
}

function distinctBuilds(reading: FleetReading): string[] {
  return [...reading.builds.keys()].sort();
}

function countOf(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

export function describeFleet(reading: FleetReading, url: string): string {
  if (reading.responses === 0) {
    return (
      `Deploy pin: ${url} answered none of ${reading.probes} probes, so this run ` +
      `is not pinned to a build.`
    );
  }
  let replicas = countOf(reading.replicas.size, 'replica');
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

// Whether the closing reading can speak for the build at all. A reading whose
// every answer was an error identifies replicas without naming a build, and a
// comparison over no builds would report "unchanged" having read nothing.
// Silence is not agreement, but it is not evidence of a deploy either: it says
// the pin is unknown, which the summary reports rather than the run being
// thrown away.
export function pinIsConfirmable(after: FleetReading): boolean {
  return pinIsReadable(after);
}

// Checked at the close, against a reading that answered. Each finding is a
// reason the numbers describe more than one deployment, stated so a reader can
// see what it rests on.
export function fleetDrift(
  before: FleetReading,
  after: FleetReading,
): string[] {
  if (!pinIsConfirmable(after) || !pinIsReadable(before)) {
    // Nothing to compare: the caller reports an unconfirmed or unpinned run.
    return [];
  }
  let findings: string[] = [];
  let seenBefore = distinctBuilds(before);
  let arrivedBuilds = distinctBuilds(after).filter(
    (b) => !seenBefore.includes(b),
  );
  if (arrivedBuilds.length) {
    findings.push(
      `the host build moved: ${seenBefore.join(' and ')} at the start, ` +
        `${arrivedBuilds.join(' and ')} at the close`,
    );
  }
  let identified = (reading: FleetReading) =>
    [...reading.replicas].filter((id) => id !== UNIDENTIFIED_REPLICA);
  let arrived = identified(after).filter((id) => !before.replicas.has(id));
  let departed = identified(before).filter((id) => !after.replicas.has(id));
  if (arrived.length || departed.length) {
    // A replaced task is both, and a scaled fleet is one or the other. Either
    // way the window is not one fleet's: an arrival served part of it cold,
    // and a departure means the load the rest of the fleet carried changed
    // partway through.
    let moved = [
      arrived.length ? `${countOf(arrived.length, 'replica')} arrived` : '',
      departed.length ? `${countOf(departed.length, 'replica')} left` : '',
    ]
      .filter(Boolean)
      .join(' and ');
    findings.push(
      `the fleet changed mid-run: ${moved} between the opening and closing ` +
        `probes (${after.probes} closing probes, which kept looking for every ` +
        `replica the opening reading saw), so part of this window was served ` +
        `by tasks the rest of it was not`,
    );
  }
  return findings;
}

// One line for the run summary, so a quoted number carries the build it
// describes — or says plainly what is not known about it.
export function describePin(before: FleetReading, after: FleetReading): string {
  if (!pinIsReadable(before)) {
    return (
      `build:    not pinned — no boot document named a host build, so these ` +
      `numbers are not tied to one`
    );
  }
  let build = distinctBuilds(before).join(' and ');
  if (!pinIsConfirmable(after)) {
    return (
      `build:    ${build} at the start, NOT CONFIRMED at the close — ` +
      `${after.probes} closing probes brought back no boot document ` +
      `(${countOf(after.responses, 'answer')}), so a deploy inside this window ` +
      `would not have been seen`
    );
  }
  return (
    `build:    ${build}, unchanged across the run ` +
    `(${before.replicas.size} replicas at the start, ${after.replicas.size} at the close)`
  );
}
