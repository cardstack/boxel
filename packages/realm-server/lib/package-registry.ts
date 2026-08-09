// The publish gate for the versioned package address space.
//
// Serving vendored packages at `<name>@<version>/<path>` only means anything
// if a version is a promise. Deck's L4 says published bytes never change:
// once `lib/three@0.169.0` has a treeHash, that name resolves to those bytes
// forever, and anything else is a different version. A registry that lets a
// republish quietly swap the treeHash turns every pin in every decklist into
// a lie, and — because the serve path marks exact versions `immutable` —
// leaves caches holding bytes nobody can reproduce.
//
// So this module is deliberately a gate rather than a helper: it answers one
// question, "may these bytes be published under this name and version," and
// it answers it as a pure function of its arguments. No clock, no filesystem.
// The caller supplies `now`; tests supply a fixed one.
//
// Nothing calls this yet — the serve handler is read-only. It lands with the
// serve door so the door is not open before the lock exists.

import semver from 'semver';
import { isValidPackageName, type StoreMeta } from '@cardstack/deck/node';

export type PublishRefusalCode =
  | 'invalid-name'
  | 'invalid-version'
  | 'tree-hash-mismatch'
  | 'cooldown';

export type PublishVerdict =
  | { kind: 'ok'; reason: 'new-version' | 'identical-republish' }
  | { kind: 'refused'; code: PublishRefusalCode; detail: string };

// Vendoring a version the upstream registry published minutes ago is how a
// compromised or mistaken release gets pinned before anyone notices. The
// default matches the Deck repo's npm policy and pnpm's own
// `minimumReleaseAge` in this workspace (1440 minutes = 1 day); callers that
// vendor from a source with no upstream timestamp pass none and skip it.
export const DEFAULT_COOLDOWN_DAYS = 1;

export interface PublishRequest {
  name: string;
  version: string;
  treeHash: string;
  // The store's current state for this package, if it has any.
  meta?: Pick<StoreMeta, 'versions'>;
  // When the UPSTREAM registry published what we are vendoring — not when we
  // fetched it. Absent means unknown, and unknown skips the cooldown rather
  // than inventing a timestamp: guessing here would either block a legitimate
  // publish or wave through the exact case the cooldown exists to catch.
  upstreamPublishedAt?: string;
  now: Date;
  cooldownDays?: number;
}

export function checkPublish(request: PublishRequest): PublishVerdict {
  let { name, version, treeHash, meta, upstreamPublishedAt, now } = request;
  let cooldownDays = request.cooldownDays ?? DEFAULT_COOLDOWN_DAYS;

  if (!isValidPackageName(name)) {
    return {
      kind: 'refused',
      code: 'invalid-name',
      detail:
        `"${name}" is not a package name: expected <publisher>/<package> or ` +
        '<package>, lowercase alphanumeric and hyphens',
    };
  }

  // Exact versions only. A range or dist-tag is a question, not an answer,
  // and publishing under one would make the address space unresolvable.
  if (semver.valid(version) !== version) {
    return {
      kind: 'refused',
      code: 'invalid-version',
      detail: `"${version}" is not an exact semver version`,
    };
  }

  let existing = meta?.versions?.[version];
  if (existing) {
    // The whole point. Same bytes is a no-op and must stay allowed, because
    // re-running a vendor script is normal and should not be an error.
    // Different bytes under a version that already exists is the refusal.
    if (existing.treeHash === treeHash) {
      return { kind: 'ok', reason: 'identical-republish' };
    }
    return {
      kind: 'refused',
      code: 'tree-hash-mismatch',
      detail:
        `${name}@${version} is already published as ${existing.treeHash}; ` +
        `refusing to republish it as ${treeHash}. Publish a new version ` +
        'instead — a version is immutable (Deck L4).',
    };
  }

  if (upstreamPublishedAt && cooldownDays > 0) {
    let published = Date.parse(upstreamPublishedAt);
    // An unparseable timestamp is a refusal, not a skip: it arrived claiming
    // to be a time, so treating it as absent would let a malformed field
    // bypass the policy silently.
    if (Number.isNaN(published)) {
      return {
        kind: 'refused',
        code: 'cooldown',
        detail: `upstreamPublishedAt "${upstreamPublishedAt}" is not a date`,
      };
    }
    let ageMs = now.getTime() - published;
    let cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
    if (ageMs < cooldownMs) {
      let hours = Math.max(0, Math.ceil((cooldownMs - ageMs) / 3_600_000));
      return {
        kind: 'refused',
        code: 'cooldown',
        detail:
          `${name}@${version} was published upstream at ${upstreamPublishedAt}, ` +
          `inside the ${cooldownDays}-day cooldown; try again in ~${hours}h`,
      };
    }
  }

  return { kind: 'ok', reason: 'new-version' };
}
