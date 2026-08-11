// Publishing a stable Version, in two phases: propose, then accept.
//
// `deck-version-is-a-proposal.md` rules that cutting a stable Version is a
// deliberate act shaped like a pull request. The shape matters more than the
// ceremony: it moves the gate from a refusal AFTER someone believed they were
// done, to a check on a thing nobody has committed to yet — and it puts the
// semver bump, the single most consequential judgement in the system, in
// front of a second pair of eyes.
//
// WHAT A PROPOSAL IS NOT. It is not a Version. Nothing here writes to the
// store's version records, nothing it produces is addressable as
// `@<version>`, and no decklist can pin it. That separation is the whole
// safety property: a proposal that is never accepted leaves the served world
// untouched, so proposing costs nothing and can be done freely.
//
// WHERE THEY LIVE, provisionally. `<store>/_proposals/<name>/<id>.json`,
// beside the store rather than inside its version records. §5 of the ruling
// lists this as not settled; it is placed here because a proposal is
// per-package state with the same lifetime as the store, and because keeping
// it out of `versions` makes "a proposal is not a Version" structural rather
// than a convention someone can forget.

import fsExtra from 'fs-extra';
import { join } from 'path';
import { checkPublish, type PublishVerdict } from './package-registry.ts';
import {
  suggestBump,
  suggestBumpForTree,
  type Bump,
  type Verdict,
} from './semver-delta.ts';

const {
  ensureDir,
  pathExists,
  readFile,
  readJson,
  readdir,
  writeFile,
  writeJson,
  remove,
} = fsExtra;

export type ProposalState = 'open' | 'accepted' | 'withdrawn';

export interface Proposal {
  id: string;
  name: string;
  /** The semver the proposer is claiming. */
  version: string;
  treeHash: string;
  /** The changelog — why a consumer should take this. A proposal without one
   *  is a number that happened; see the ruling §1.1. */
  body: string;
  proposedBy: string;
  proposedAt: string;
  state: ProposalState;
  acceptedBy?: string;
  acceptedAt?: string;
  /** Why it was accepted at a bump lower than suggested. Required in that
   *  case — see `acceptProposal`. */
  overrideReason?: string;
  /** The gate's verdict at propose time. */
  gate: PublishVerdict;
  /** The structural pass, when a predecessor existed to compare against. */
  delta?: Verdict & { comparedWith: string };
  /**
   * The candidate's entry source, carried so that what is accepted is what
   * was reviewed.
   *
   * A proposal that named only a treeHash would be reviewable but not
   * publishable: the bytes would have to be re-supplied at accept time by
   * whoever clicked accept, and nothing would tie them to the diff the
   * reviewer read. Carrying the source lets the accepting side re-derive the
   * seal and refuse if it does not match what was proposed.
   *
   * For a single-module package this is the module. A package that is a TREE
   * carries its bytes as a pack instead — see `packFile`.
   */
  source?: string;
  /**
   * The proposed pack, stored beside this record as `<id>.pack`.
   *
   * A tree cannot live in a JSON string, and re-packing the realm at accept
   * time would publish whatever the tree says THEN — which is not what anyone
   * reviewed. Freezing the bytes at propose time is what makes the review
   * about a fixed thing, and it makes the seal check at acceptance a real
   * guard rather than a formality: if the realm moved on, the proposal still
   * holds the Version that was read.
   */
  packFile?: string;
  /** Where a tree proposal came from, for a reader deciding whether to trust
   *  it. Absent on a proposal whose bytes were supplied directly. */
  origin?: { realm: string; root?: string };
  /** Structural findings that are worth a reviewer's attention but are not
   *  certain enough to refuse on — see `findEscapingImports`. */
  warnings?: string[];
}

export interface ProposeInput {
  storeDir: string;
  name: string;
  version: string;
  treeHash: string;
  body: string;
  proposedBy: string;
  /** The candidate's entry source, and the current Version's, when both are
   *  available. Absent means no structural verdict rather than a guessed one. */
  candidateSource?: string;
  priorSource?: string;
  priorVersion?: string;
  /** Kept on the record; defaults to `candidateSource`. */
  source?: string;
  /** A whole-tree candidate and its predecessor, keyed by pack-relative path.
   *  Supplied instead of the single-source pair, and compared with the
   *  tree-level structural pass. */
  candidateTree?: Map<string, string>;
  priorTree?: Map<string, string>;
  /** The pack bytes to freeze beside the record. */
  packBytes?: Buffer;
  origin?: { realm: string; root?: string };
  warnings?: string[];
  meta?: Parameters<typeof checkPublish>[0]['meta'];
  now?: Date;
  id?: string;
}

function proposalsDir(storeDir: string, name: string): string {
  return join(storeDir, '_proposals', name);
}

const RANK: Record<Bump, number> = { patch: 0, minor: 1, major: 2 };

/**
 * The bump a version number claims, relative to what came before it.
 *
 * Read off the numbers rather than trusted from the proposer: the point of
 * the comparison is to catch a proposer who called a break a minor, so taking
 * their word for which kind of change it is would defeat it.
 */
export function claimedBump(prior: string, next: string): Bump | undefined {
  let a = prior.split('.').map((n) => Number(n));
  let b = next.split('.').map((n) => Number(n));
  if (a.length < 3 || b.length < 3 || [...a, ...b].some((n) => !isFinite(n))) {
    return undefined;
  }
  // Each test is anchored on the components to its LEFT being equal. Reading
  // them independently says `4.0.0 → 1.2.3` is a minor, because 2 > 0 — and a
  // version that went backwards would then be graded against a suggestion
  // computed for a line it does not belong to. Undefined is the honest answer
  // for anything that is not an increment; the caller asks about it.
  if (b[0] > a[0]) return 'major';
  if (b[0] === a[0] && b[1] > a[1]) return 'minor';
  if (b[0] === a[0] && b[1] === a[1] && b[2] > a[2]) return 'patch';
  return undefined;
}

/**
 * Phase one. Records the claim, the argument for it, and both verdicts.
 *
 * Refusals from the gate are RECORDED, not thrown. A proposal that the gate
 * would refuse is exactly the proposal worth looking at — throwing it away
 * would hide the case review exists for, and a reviewer can read the refusal
 * and decide what to do about it.
 */
export async function proposeVersion(input: ProposeInput): Promise<Proposal> {
  let now = input.now ?? new Date();
  let gate = checkPublish({
    name: input.name,
    version: input.version,
    treeHash: input.treeHash,
    meta: input.meta,
    now,
  });

  let delta: Proposal['delta'] | undefined;
  if (input.candidateTree && input.priorTree) {
    delta = {
      ...suggestBumpForTree(input.priorTree, input.candidateTree),
      comparedWith: input.priorVersion ?? 'previous',
    };
  } else if (input.candidateSource != null && input.priorSource != null) {
    delta = {
      ...suggestBump(input.priorSource, input.candidateSource),
      comparedWith: input.priorVersion ?? 'previous',
    };
  }

  let id = input.id ?? `${input.version}-${now.getTime().toString(36)}`;
  let proposal: Proposal = {
    id,
    name: input.name,
    version: input.version,
    treeHash: input.treeHash,
    body: input.body,
    proposedBy: input.proposedBy,
    proposedAt: now.toISOString(),
    state: 'open',
    gate,
    ...(delta ? { delta } : {}),
    ...((input.source ?? input.candidateSource)
      ? { source: input.source ?? input.candidateSource }
      : {}),
    ...(input.packBytes ? { packFile: `${id}.pack` } : {}),
    ...(input.origin ? { origin: input.origin } : {}),
    ...(input.warnings?.length ? { warnings: input.warnings } : {}),
  };

  let dir = proposalsDir(input.storeDir, input.name);
  await ensureDir(dir);
  // The bytes land BEFORE the record that points at them. A record naming a
  // pack that is not there yet is a proposal nobody can accept; a pack with
  // no record yet is inert, and the next propose overwrites it.
  if (input.packBytes) {
    await writeFile(join(dir, `${id}.pack`), input.packBytes);
  }
  await writeJson(join(dir, `${proposal.id}.json`), proposal, { spaces: 2 });
  return proposal;
}

/** The frozen bytes of a tree proposal, if it has any. */
export async function readProposalPack(
  storeDir: string,
  name: string,
  proposal: Proposal,
): Promise<Buffer | undefined> {
  if (!proposal.packFile) {
    return undefined;
  }
  let file = join(proposalsDir(storeDir, name), proposal.packFile);
  return (await pathExists(file)) ? await readFile(file) : undefined;
}

export async function listProposals(
  storeDir: string,
  name: string,
): Promise<Proposal[]> {
  let dir = proposalsDir(storeDir, name);
  if (!(await pathExists(dir))) {
    return [];
  }
  let files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  let proposals: Proposal[] = [];
  for (let file of files) {
    try {
      proposals.push(await readJson(join(dir, file)));
    } catch {
      // One unreadable proposal must not hide the rest. A queue that refuses
      // to render because of a single bad file is worse than a short queue.
    }
  }
  return proposals.sort((a, b) => b.proposedAt.localeCompare(a.proposedAt));
}

export async function readProposal(
  storeDir: string,
  name: string,
  id: string,
): Promise<Proposal | undefined> {
  let file = join(proposalsDir(storeDir, name), `${id}.json`);
  if (!(await pathExists(file))) {
    return undefined;
  }
  try {
    return await readJson(file);
  } catch {
    return undefined;
  }
}

export type AcceptResult =
  | { kind: 'accepted'; proposal: Proposal }
  | {
      kind: 'refused';
      code:
        | 'unknown-proposal'
        | 'not-open'
        | 'gate-refused'
        | 'override-needs-reason'
        | 'claim-does-not-follow';
      detail: string;
    };

export interface AcceptInput {
  storeDir: string;
  name: string;
  id: string;
  acceptedBy: string;
  /** Required when accepting below the suggested bump. */
  overrideReason?: string;
  now?: Date;
  /**
   * The effect that makes the Version exist — publishing the pack — run after
   * every check has passed and before the record is marked accepted.
   *
   * Sequenced here rather than left to the caller so the two cannot disagree.
   * Marking first and publishing after would, on a failed publish, leave a
   * proposal claiming a Version that nobody can resolve; publishing first and
   * marking after would run the effect before the override check that exists
   * to stop it. A `commit` that throws leaves the proposal open, which is the
   * state a retry can proceed from.
   */
  commit?: (proposal: Proposal) => Promise<void>;
}

/**
 * Phase two. Marks a proposal accepted, having checked the two things that
 * cannot be checked at propose time: that the gate still says yes, and that
 * nobody is quietly accepting below the floor.
 *
 * THE FLOOR IS NOT ADVISORY. The structural pass may be raised and never
 * lowered — a wrong "minor" ships a break to everyone on a caret range, a
 * wrong "major" costs one unnecessary bump. So accepting a claim weaker than
 * the structural verdict is allowed (the pass is imperfect and a human may
 * know better) but it must carry a REASON, and that reason lands in the
 * Version's own record. It is exactly the sentence a future reader wants when
 * the break surfaces.
 *
 * Accepting does not itself write bytes to the store. The caller supplies
 * that effect as `commit`, and this runs it after the checks and before the
 * record is marked — so a failed publish cannot leave a proposal marked
 * accepted for a Version that does not exist, and the effect can never run
 * ahead of the check that exists to stop it.
 */
export async function acceptProposal(
  input: AcceptInput,
): Promise<AcceptResult> {
  let proposal = await readProposal(input.storeDir, input.name, input.id);
  if (!proposal) {
    return {
      kind: 'refused',
      code: 'unknown-proposal',
      detail: `no proposal ${input.id} for ${input.name}`,
    };
  }
  if (proposal.state !== 'open') {
    return {
      kind: 'refused',
      code: 'not-open',
      detail: `proposal ${input.id} is already ${proposal.state}`,
    };
  }
  if (proposal.gate.kind === 'refused') {
    return {
      kind: 'refused',
      code: 'gate-refused',
      detail: `the gate refused this at propose time (${proposal.gate.code}): ${proposal.gate.detail}`,
    };
  }

  let suggested = proposal.delta?.bump;
  let claimed = proposal.delta
    ? claimedBump(proposal.delta.comparedWith, proposal.version)
    : undefined;

  // The claim does not follow the Version it was compared against — it goes
  // backwards, or sideways. Deck permits it: a patch on an older line is a
  // real thing to publish. But the structural verdict on this proposal was
  // computed against the HIGHEST version, so it describes a delta this claim
  // is not making, and letting it through would mean publishing a number
  // nothing checked. Cheaper to ask than to be wrong: the same reason field,
  // a different question.
  if (proposal.delta && !claimed && !input.overrideReason) {
    return {
      kind: 'refused',
      code: 'claim-does-not-follow',
      detail:
        `${proposal.version} does not follow ${proposal.delta.comparedWith}, ` +
        'which is what the structural pass compared it against — so that ' +
        'verdict does not describe this claim. Publishing onto an older line ' +
        'is allowed; say why, and the reason is kept.',
    };
  }

  if (
    suggested &&
    claimed &&
    RANK[claimed] < RANK[suggested] &&
    !input.overrideReason
  ) {
    return {
      kind: 'refused',
      code: 'override-needs-reason',
      detail:
        `the structural pass suggests ${suggested} and this claims ${claimed}. ` +
        'Accepting below the suggestion is allowed, but say why — the reason ' +
        "goes into the Version's record for whoever meets the break later.",
    };
  }

  let now = input.now ?? new Date();
  if (input.commit) {
    // Deliberately unguarded: a publish that fails should surface as itself,
    // not as a refusal code invented here. The proposal stays open.
    await input.commit(proposal);
  }
  let accepted: Proposal = {
    ...proposal,
    state: 'accepted',
    acceptedBy: input.acceptedBy,
    acceptedAt: now.toISOString(),
    ...(input.overrideReason ? { overrideReason: input.overrideReason } : {}),
  };
  await writeJson(
    join(proposalsDir(input.storeDir, input.name), `${proposal.id}.json`),
    accepted,
    { spaces: 2 },
  );
  return { kind: 'accepted', proposal: accepted };
}

export async function withdrawProposal(
  storeDir: string,
  name: string,
  id: string,
): Promise<boolean> {
  let proposal = await readProposal(storeDir, name, id);
  if (!proposal || proposal.state !== 'open') {
    return false;
  }
  await writeJson(
    join(proposalsDir(storeDir, name), `${id}.json`),
    { ...proposal, state: 'withdrawn' },
    { spaces: 2 },
  );
  return true;
}

/** Test/demo housekeeping: drop a package's proposals entirely. */
export async function clearProposals(
  storeDir: string,
  name: string,
): Promise<void> {
  await remove(proposalsDir(storeDir, name));
}
