// The write door for the versioned package address space: propose a Version,
// review it, accept it.
//
// `deck-version-is-a-proposal.md` rules that cutting a stable Version is a
// deliberate act shaped like a pull request. `lib/package-proposals.ts` holds
// the rules; this is the door they are reachable through, and it is a
// SEPARATE door from `/_packages/` on purpose. That handler's own header
// records the invariant — "a GET must never be able to mutate the store, and
// keeping the gate out of reach is cheaper than proving it is never
// invoked" — so the mutating half lives at its own path, behind its own
// authentication, rather than as a branch inside the read path.
//
//   GET  /_package-proposals/<name>   → the queue, newest first
//   POST /_package-proposals/<name>   → { action: analyze | propose | accept | withdraw }
//
// THE ACTION IS IN THE BODY, not the path, because a package name may itself
// contain a slash (`lib/palette`). A trailing `/accept` would be
// indistinguishable from a package legitimately named that, and the choice is
// between an ambiguous URL grammar and a reserved-word rule nobody would
// remember. One address per package, with the verb in the body, has neither
// problem.
//
// IDENTITY COMES FROM THE TOKEN, never from the request body. A proposal
// whose `proposedBy` was a string the proposer typed would make the review
// trail decorative — the whole point of §1.2 is that a second party looked at
// the bump, and a self-asserted name cannot establish that a second party
// exists. `acceptedBy` matters even more: it is the signature on the claim.

import type Koa from 'koa';
import semver from 'semver';
import { logger } from '@cardstack/runtime-common';
import {
  pack,
  publishToStore,
  readStoreMeta,
  readStoredFile,
  readStoredPack,
  unpack,
} from '@cardstack/deck/node';
import {
  fetchRequestFromContext,
  setContextResponse,
} from '../middleware/index.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import { findOrMountRealm } from '../lib/realm-routing.ts';
import {
  acceptProposal,
  listProposals,
  proposeVersion,
  readProposalPack,
  withdrawProposal,
} from '../lib/package-proposals.ts';
import {
  authoredOnly,
  discoverRealmPackages,
  packRealmPackage,
  storeNameFor,
} from '../lib/realm-packages.ts';
import { suggestBump, type Bump } from '../lib/semver-delta.ts';
import {
  realmsToInvalidateOnPublish,
  type RealmInvalidation,
} from '../lib/package-publish-invalidation.ts';

const log = logger('realm-server:package-proposals');

const ENTRY = 'index.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // Never cached. Every answer here is about a queue that is being
      // changed by the very requests hitting this door.
      'cache-control': 'no-store',
    },
  });
}

function error(status: number, code: string, detail: string): Response {
  return json(status, { errors: [{ code, detail }] });
}

// The pack layout this demo's library uses, kept identical to
// `scripts/seed-package-store.mjs` so a version cut from the card and a
// version cut from the seed script are the same kind of object. `pack` is
// deterministic, so the treeHash is a pure function of these bytes — which is
// what lets acceptance re-derive the seal and check it (see `sealOf`).
export function packLibrary(
  name: string,
  version: string,
  source: string,
): Buffer {
  let key = name.split('/').at(-1)!;
  return pack([
    {
      path: 'importmap.json',
      bytes: Buffer.from(
        JSON.stringify(
          {
            deck: { packages: { [key]: { version, entry: '$DECK/index.js' } } },
          },
          null,
          2,
        ),
      ),
    },
    { path: ENTRY, bytes: Buffer.from(source) },
    {
      path: 'README.md',
      bytes: Buffer.from(`# ${key} ${version}\n\nFixture library.\n`),
    },
  ]);
}

function sealOf(name: string, version: string, source: string): string {
  return unpack(packLibrary(name, version, source)).treeHash;
}

// The Version a consumer on a caret range is actually holding — the highest
// semver, not the most recently published. Those differ the moment a patch
// lands on an older line, and it is the former that a break would break.
function currentVersion(versions: string[]): string | undefined {
  return semver.rsort(versions.filter((v) => semver.valid(v)))[0];
}

async function priorOf(
  storeDir: string,
  name: string,
): Promise<{ version: string; source: string } | undefined> {
  let meta = await readStoreMeta(storeDir, name);
  let version = currentVersion(Object.keys(meta?.versions ?? {}));
  if (!version) {
    return undefined;
  }
  let bytes = await readStoredFile(storeDir, name, version, ENTRY);
  return bytes ? { version, source: bytes.toString('utf8') } : undefined;
}

/** Every module in a published Version, keyed by pack-relative path. */
async function treeOf(
  storeDir: string,
  name: string,
  version: string,
): Promise<Map<string, string> | undefined> {
  let bytes = await readStoredPack(storeDir, name, version);
  if (!bytes) {
    return undefined;
  }
  let tree = new Map<string, string>();
  for (let [path, content] of unpack(bytes).files) {
    tree.set(path, content.toString('utf8'));
  }
  return tree;
}

/**
 * Propose a Version of a package the realm itself declares.
 *
 * THE VERSION IS NOT IN THE REQUEST. It is read out of the realm's
 * `importmap.json`, which is the design doc's gate rule: the manifest check
 * reads `boxel.packages[<name>].version` rather than trusting a number the
 * caller passed. That puts the claim in a file that lives with the code,
 * moves with it, and is reviewable in the same diff — instead of in a form
 * field somebody filled in once.
 *
 * The bytes are FROZEN here, not re-derived at acceptance. Re-packing on
 * accept would publish whatever the realm says at that moment, which is not
 * what the reviewer read; the seal check at acceptance then becomes a real
 * guard on exactly that.
 */
async function proposeFromRealm({
  args,
  storeDir,
  name,
  actor,
  input,
}: {
  args: CreateRoutesArgs;
  storeDir: string;
  name: string;
  actor: string;
  input: Record<string, any>;
}): Promise<Response> {
  let { realm: realmURL, package: key } = input.from ?? {};
  if (typeof realmURL !== 'string' || typeof key !== 'string') {
    return error(
      400,
      'malformed-from',
      'from must be { realm: <url>, package: <name declared by that realm> }',
    );
  }
  if (typeof input.body !== 'string' || !input.body.trim()) {
    return error(
      400,
      'no-changelog',
      'a proposal needs a body: what is a consumer taking on?',
    );
  }

  let realm = await findOrMountRealm(new URL(realmURL), {
    realms: args.realms,
    reconciler: args.reconciler,
    dbAdapter: args.dbAdapter,
  });
  if (!realm) {
    return error(404, 'unknown-realm', `no realm at ${realmURL}`);
  }
  // A realm this server serves but does not hold on disk has no tree to pack.
  // Distinct from "no such realm", and a caller can act on the difference.
  let realmDir = realm.dir;
  if (!realmDir) {
    return error(
      409,
      'realm-not-local',
      `${realmURL} is not backed by a directory on this server`,
    );
  }

  // Found by scanning for manifests, not read out of a registry the realm
  // keeps: a package's name lives in the package, so that moving it does not
  // rename it and break every pin.
  let { packages, problems } = await discoverRealmPackages(realmDir);
  let found = packages.find((p) => p.key === key);
  if (!found) {
    return json(404, {
      errors: [
        {
          code: 'no-such-package',
          detail: `${realmURL} holds no package named "${key}"`,
        },
      ],
      // A manifest this scan could not read is the likeliest reason a package
      // somebody knows exists was not found, so say so rather than leaving
      // them to guess.
      problems,
    });
  }

  // The address the caller used has to agree with what the package says it is.
  // Accepting a different name in the URL would let a package be published
  // into somebody else's namespace.
  let derived = storeNameFor(found.publisher, key);
  if (derived !== name) {
    return error(
      409,
      'name-mismatch',
      `${found.path} calls itself ${derived}, not ${name}`,
    );
  }
  if (!found.publisher && name.includes('/')) {
    return error(
      409,
      'no-namespace',
      `${found.path} declares no publisher, so "${key}" is depot-local and ` +
        'cannot be published under a namespace. Add "publisher" to its manifest.',
    );
  }

  let packed = await packRealmPackage({
    packageDir: found.dir,
    key,
    declaration: found.declaration,
    // Ranges in the package's own manifest, resolved against this server's
    // store into the pins that get sealed with it.
    dependencies: found.dependencies,
    storeDir,
  });
  if (packed.kind === 'refused') {
    return json(409, { refused: { code: packed.code, detail: packed.detail } });
  }

  let version = found.declaration.version!;
  let meta = await readStoreMeta(storeDir, name);
  let priorVersion = currentVersion(Object.keys(meta?.versions ?? {}));
  // Authored files on both sides. A published pack holds source AND compiled
  // output; the candidate side is authored-only, so comparing against the
  // whole pack would read every built module as deleted.
  let priorTree = priorVersion
    ? authoredOnly((await treeOf(storeDir, name, priorVersion)) ?? new Map())
    : undefined;
  // The AUTHORED files, not everything in the pack. Comparing compiled output
  // would report the transpiler's choices as changes to the package's API,
  // and a compiler upgrade would read as a breaking release.
  let candidateTree = packed.sources;

  let proposal = await proposeVersion({
    storeDir,
    name,
    version,
    treeHash: packed.treeHash,
    body: input.body,
    proposedBy: actor,
    packBytes: packed.bytes,
    candidateTree,
    priorTree,
    priorVersion,
    origin: { realm: realmURL, root: found.path },
    warnings: packed.warnings,
    pins: packed.pins,
    meta: meta ?? undefined,
  });
  return json(201, { proposal, files: packed.files });
}

// Seed a reindex in every realm holding a row whose range now resolves to the
// Version just published. Returns what was selected so the publish response
// can say it out loud — "your 2.3.0 moved 12 files in 2 realms" is the kind of
// thing a publisher should learn at publish time rather than from a support
// ticket.
//
// Deliberately never throws. A publish that succeeded has succeeded; failing
// the response because a downstream realm could not be reindexed would report
// a stored, sealed, addressable Version as an error.
async function invalidateRangesNowResolvingTo(options: {
  args: CreateRoutesArgs;
  storeDir: string;
  name: string;
  version: string | undefined;
}): Promise<RealmInvalidation[]> {
  let { args, storeDir, name, version } = options;
  if (!version) {
    return [];
  }
  let selected: RealmInvalidation[] = [];
  try {
    selected = await realmsToInvalidateOnPublish({
      dbAdapter: args.dbAdapter,
      storeDir,
      name,
      version,
    });
  } catch (err: any) {
    log.error(
      `could not work out what ${name}@${version} invalidates: ${err.message}`,
    );
    return [];
  }

  for (let { realmURL, urls, ranges } of selected) {
    // Only realms this instance is actually serving. A realm mounted on a
    // peer is that peer's to reindex, and this handler has no way to reach
    // its indexer — see the note in the response block about what is still
    // missing here.
    let realm = args.realms.find((r) => r.url === realmURL);
    if (!realm) {
      log.info(
        `${name}@${version} invalidates ${urls.length} file(s) in ${realmURL}, ` +
          'which is not mounted here — skipping',
      );
      continue;
    }
    log.info(
      `${name}@${version} now answers ${ranges.join(', ')}; reindexing ` +
        `${urls.length} file(s) in ${realmURL}`,
    );
    // Not awaited: the publisher gets their 200 without waiting on the
    // indexer. The catch is what keeps an unhandled rejection from taking
    // the process down.
    realm.realmIndexUpdater
      .update(urls.map((u) => new URL(u)))
      .catch((err: any) =>
        log.error(`reindex of ${realmURL} after ${name}@${version}: ${err}`),
      );
  }
  return selected;
}

export default function handlePackageProposals(
  args: CreateRoutesArgs,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  let { packageStorePath } = args;
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    if (!packageStorePath) {
      return setContextResponse(
        ctxt,
        error(
          501,
          'package-serving-not-configured',
          'this realm server has no package store configured',
        ),
      );
    }
    let storeDir = packageStorePath;

    let raw = ctxt.params?.rest;
    let name = (Array.isArray(raw) ? raw.join('/') : (raw ?? '')).replace(
      /\/+$/,
      '',
    );
    if (!name) {
      return setContextResponse(
        ctxt,
        error(400, 'no-package', 'expected /_package-proposals/<name>'),
      );
    }

    if (ctxt.method === 'GET') {
      return setContextResponse(
        ctxt,
        json(200, { name, proposals: await listProposals(storeDir, name) }),
      );
    }

    let token = ctxt.state.token as RealmServerTokenClaim | undefined;
    if (!token?.user) {
      return setContextResponse(
        ctxt,
        error(401, 'no-identity', 'a proposal needs an authenticated author'),
      );
    }
    let actor = token.user;

    let request = await fetchRequestFromContext(ctxt);
    let input: Record<string, any>;
    try {
      input = JSON.parse(await request.text());
    } catch {
      return setContextResponse(
        ctxt,
        error(400, 'malformed-body', 'request body is not valid JSON'),
      );
    }

    switch (input.action) {
      // Not a mutation, and deliberately available BEFORE a version number is
      // claimed. §3.3: the proposal should arrive with its bump already
      // argued, which only helps if the argument reaches the author while
      // they are still choosing the number. Asking them to guess first and
      // then telling them they guessed wrong is the workflow this replaces.
      case 'analyze': {
        if (typeof input.source !== 'string') {
          return setContextResponse(
            ctxt,
            error(400, 'no-source', 'analyze needs the candidate source'),
          );
        }
        let prior = await priorOf(storeDir, name);
        if (!prior) {
          return setContextResponse(
            ctxt,
            json(200, {
              suggested: { bump: null, version: '1.0.0' },
              detail:
                'nothing is published under this name yet, so there is no ' +
                'delta to read — the first Version is a decision, not a diff',
            }),
          );
        }
        let delta = suggestBump(prior.source, input.source);
        return setContextResponse(
          ctxt,
          json(200, {
            comparedWith: prior.version,
            delta,
            suggested: {
              bump: delta.bump,
              version: semver.inc(prior.version, delta.bump as Bump),
            },
            unchanged: prior.source === input.source,
          }),
        );
      }

      case 'propose': {
        // Two ways to supply the candidate, and only one of them is the
        // interesting one. `source` is a module handed over directly — the
        // fixture path. `from` names a realm and a package the realm's own
        // `importmap.json` declares, and the bytes are packed out of that
        // realm's tree. The second is how a card someone actually wrote
        // becomes an address another realm can pin.
        if (typeof input.source !== 'string' || !input.source.trim()) {
          if (!input.from) {
            return setContextResponse(
              ctxt,
              error(
                400,
                'no-source',
                'a proposal needs candidate bytes: either `source`, or ' +
                  '`from: { realm, package }` naming a package the realm declares',
              ),
            );
          }
          return setContextResponse(
            ctxt,
            await proposeFromRealm({ args, storeDir, name, actor, input }),
          );
        }
        // §1.1: a Version needs a body. Refused here rather than defaulted to
        // an empty string, because a changelog that can be skipped is a
        // changelog that will be.
        if (typeof input.body !== 'string' || !input.body.trim()) {
          return setContextResponse(
            ctxt,
            error(
              400,
              'no-changelog',
              'a proposal needs a body: what is a consumer taking on?',
            ),
          );
        }
        let version = String(input.version ?? '');
        let prior = await priorOf(storeDir, name);
        let meta = await readStoreMeta(storeDir, name);
        // The seal is computed here, from the bytes, rather than accepted
        // from the client. A treeHash the proposer supplied would be a claim
        // about the claim.
        let treeHash = semver.valid(version)
          ? sealOf(name, version, input.source)
          : '';
        let proposal = await proposeVersion({
          storeDir,
          name,
          version,
          treeHash,
          body: input.body,
          proposedBy: actor,
          source: input.source,
          candidateSource: input.source,
          priorSource: prior?.source,
          priorVersion: prior?.version,
          meta: meta ?? undefined,
        });
        return setContextResponse(ctxt, json(201, { proposal }));
      }

      case 'accept': {
        if (typeof input.id !== 'string') {
          return setContextResponse(
            ctxt,
            error(400, 'no-id', 'accept needs a proposal id'),
          );
        }
        let published: { version: string; treeHash: string } | undefined;
        let result = await acceptProposal({
          storeDir,
          name,
          id: input.id,
          acceptedBy: actor,
          overrideReason: input.overrideReason,
          commit: async (proposal) => {
            // A tree proposal froze its bytes at propose time; a single-module
            // one re-packs from the source it recorded. Either way the seal
            // below is checked against what the proposal claimed, so the two
            // paths make the same promise.
            let bytes =
              (await readProposalPack(storeDir, name, proposal)) ??
              (proposal.source
                ? packLibrary(name, proposal.version, proposal.source)
                : undefined);
            if (!bytes) {
              throw new Error(
                `proposal ${proposal.id} carries neither a pack nor a source, ` +
                  'so there are no bytes to publish',
              );
            }
            // The seal is re-derived and checked rather than trusted. It
            // costs one unpack and it is the difference between "these are
            // the bytes that were reviewed" being enforced and being assumed.
            let seal = unpack(bytes).treeHash;
            if (seal !== proposal.treeHash) {
              throw new Error(
                `the proposal sealed as ${proposal.treeHash} but its bytes ` +
                  `now seal as ${seal}; refusing to publish bytes that are ` +
                  'not the ones that were reviewed',
              );
            }
            let record = await publishToStore(
              storeDir,
              name,
              proposal.version,
              bytes,
            );
            published = {
              version: proposal.version,
              treeHash: record.treeHash,
            };
          },
        });
        if (result.kind === 'refused') {
          // 409, not 400: the request is well-formed and the refusal is about
          // the state of the thing, which is exactly what a reviewer needs to
          // read and act on.
          return setContextResponse(
            ctxt,
            json(409, {
              refused: { code: result.code, detail: result.detail },
            }),
          );
        }
        // The Version is in the store now, so the resolver answers with it —
        // which means every range that now resolves here is describing code
        // that changed under it. Selecting is cheap (one query) and is done
        // inline so the publisher gets told what their release moved; the
        // reindex it seeds is not awaited, because a publish should not block
        // on however long other realms take to catch up.
        let invalidated = await invalidateRangesNowResolvingTo({
          args,
          storeDir,
          name,
          version: published?.version,
        });
        return setContextResponse(
          ctxt,
          json(200, { proposal: result.proposal, published, invalidated }),
        );
      }

      case 'withdraw': {
        if (typeof input.id !== 'string') {
          return setContextResponse(
            ctxt,
            error(400, 'no-id', 'withdraw needs a proposal id'),
          );
        }
        let ok = await withdrawProposal(storeDir, name, input.id);
        return setContextResponse(
          ctxt,
          json(ok ? 200 : 409, { withdrawn: ok }),
        );
      }

      default:
        return setContextResponse(
          ctxt,
          error(
            400,
            'unknown-action',
            `expected action analyze, propose, accept or withdraw; got ${JSON.stringify(input.action)}`,
          ),
        );
    }
  };
}
