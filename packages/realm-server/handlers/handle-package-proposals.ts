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
import {
  pack,
  publishToStore,
  readStoreMeta,
  readStoredFile,
  unpack,
} from '@cardstack/deck/node';
import {
  fetchRequestFromContext,
  setContextResponse,
} from '../middleware/index.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import {
  acceptProposal,
  listProposals,
  proposeVersion,
  withdrawProposal,
} from '../lib/package-proposals.ts';
import { suggestBump, type Bump } from '../lib/semver-delta.ts';

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

export default function handlePackageProposals({
  packageStorePath,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
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
        if (typeof input.source !== 'string' || !input.source.trim()) {
          return setContextResponse(
            ctxt,
            error(400, 'no-source', 'a proposal needs the candidate source'),
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
            if (!proposal.source) {
              throw new Error(
                `proposal ${proposal.id} carries no source, so there are no ` +
                  'bytes to publish',
              );
            }
            // The seal is re-derived and checked rather than trusted. It
            // costs one pack and it is the difference between "these are the
            // bytes that were reviewed" being enforced and being assumed.
            let bytes = packLibrary(name, proposal.version, proposal.source);
            let seal = unpack(bytes).treeHash;
            if (seal !== proposal.treeHash) {
              throw new Error(
                `the proposal sealed as ${proposal.treeHash} but its source ` +
                  `now packs to ${seal}; refusing to publish bytes that are ` +
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
        return setContextResponse(
          ctxt,
          json(200, { proposal: result.proposal, published }),
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
