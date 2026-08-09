// `@cardstack/deck/node` — everything that needs a filesystem.
//
// The companion to the root entry (see `index.ts` for why the root is the
// browser-safe one). This is what a server embeds: tree identity over real
// directories, the object store, packs, locking, verification, signatures.
//
// One entry rather than twenty-odd subpaths, because a consumer wants a
// contract, not an archaeology dig — and because every deep import is a
// promise about internal layout that this package would then owe forever.
// The granular subpaths still resolve; they are how this repo's own packages
// import, and they are not part of what an embedder should reach for.

export * from './index.ts';

export {
  TREE_HASH_SPEC,
  hashBytes,
  isValidTreePath,
  treeHashFromDir,
  treeHashFromEntries,
} from './tree-hash.ts';
export type { TreeHashEntry } from './tree-hash.ts';

export { pack, packFromDir, unpack } from './pack.ts';

export {
  PACKLIST_PATH,
  PACK_FORMAT,
  createPacklist,
  intakeReadiness,
  parsePacklist,
  serializePacklist,
} from './packlist.ts';
export type {
  PackMode,
  PackProvenance,
  Packlist,
  PacklistEntry,
  PrunedRecord,
} from './packlist.ts';

export { packagesFromPack } from './import-map-pack.ts';

// Hermetic carriage: the half of `planPack` that fetches. On `/node` rather
// than the root because it reaches the filesystem-side modules, and because
// the only caller that matters is a server building a pack to hand over.
export { VENDOR_PREFIX, carryHermetic } from './pack-hermetic.ts';
export type {
  CarryHermeticOptions,
  CarryHermeticResult,
} from './pack-hermetic.ts';

export {
  inspectStore,
  // What counts as a package name and a dist-tag is protocol, not a detail
  // of this implementation: an embedder building a publish gate has to
  // refuse the same names this store refuses, and the alternative to
  // exporting these is every consumer re-deriving the rules from the docs
  // and drifting. Found by a consumer that needed exactly this.
  isValidDistTag,
  isValidPackageName,
  listStorePackages,
  publishToStore,
  readStoreMeta,
  readStoredFile,
  readStoredPack,
  releaseVersion,
  resolveVersionSpec,
} from './store.ts';
// A caller that reads store metadata needs to be able to name its type —
// otherwise it either restates the shape or reaches for `any`.
export type {
  SpecResolution,
  StoreMeta,
  StoreVersionRecord,
  StorageKind,
} from './store.ts';

export { verifyLinks } from './verify-links.ts';

export { readTreeFromDir, writeTreeToDir } from './tree.ts';
export type { WriteTreeResult } from './tree.ts';

// Resolution over a store: ranges in, pins out, plus the scopes that let two
// decks disagree about a version. An embedder implementing catalog verbs —
// install, upgrade, remix — is doing exactly this, and doing it by hand means
// reimplementing range resolution against dist-tags and prereleases.
export {
  LIVE_SPEC,
  applyLock,
  lockDeck,
  parseDependencyValue,
  resolveDependencies,
  resolveScopes,
} from './lock.ts';
export type {
  DependencyResolution,
  DependencyValue,
  LockResult,
  ResolveOptions,
  ScopedResolution,
} from './lock.ts';

export { forkDeck } from './fork.ts';
export type {
  ForkOptions,
  ForkResult,
  ForkSource,
  ForkTarget,
} from './fork.ts';

// Offers: a fork that records its base, so a proposal is a Version rather
// than a diff. `applyRebase` is the only thing here that writes.
export {
  applyRebase,
  discoverOffers,
  offerTreeHash,
  planRebase,
  readForkedFrom,
  writeForkedFrom,
  writeOfferMap,
} from './offer.ts';
export type {
  ForkedFrom,
  Offer,
  PlanRebaseOptions,
  RebaseApplied,
  RebasePlan,
  RebaseState,
} from './offer.ts';

// Endorsement (L9/L10). `TREE_HASH_SPEC` is deliberately not re-exported
// from here — `signature.ts` declares its own copy of the same constant, and
// the one on this entry comes from `tree-hash.ts`, which is its home.
export {
  SIG_SPEC,
  emptyEnvelope,
  envelopePath,
  generateKeyPair,
  keyIdFor,
  signTreeHash,
  signingPayload,
  summarizeEnvelope,
  verifyEnvelope,
  verifySignature,
} from './signature.ts';
export type {
  EnvelopeVerdict,
  KeyPair,
  Signature,
  SignatureEnvelope,
  SignatureRole,
  SignatureSummary,
} from './signature.ts';
