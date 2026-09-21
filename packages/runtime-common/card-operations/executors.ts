import { cloneDeep, isEqual, merge, mergeWith } from 'lodash-es';
import { v4 as uuidV4 } from 'uuid';

import { visitModuleDeps, type CodeRef } from '../code-ref.ts';
import type { JsonValue } from '../json-validation.ts';
import {
  getImmediateFieldDef,
  type Definition,
  type FieldDefinition,
} from '../definitions.ts';
import { getCardDirectoryName } from '../helpers/card-directory-name.ts';
import { isSingleCardDocument } from '../document-types.ts';
import { hasExecutableExtension } from '../index.ts';
import {
  inferContentType,
  isBinaryContentType,
  isJSONContentType,
} from '../infer-content-type.ts';
import { mergeRelationships } from '../merge-relationships.ts';
import type { RealmPaths } from '../paths.ts';
import { ensureTrailingSlash, type LocalPath } from '../paths.ts';
import { normalizeRelationships } from '../relationship-utils.ts';
import {
  clearReplacedArrayFieldMeta,
  isCardResource,
  type CardResource,
  type Relationship,
} from '../resource-types.ts';
import {
  splice,
  streamSpliced,
  wholeFile,
  wholeText,
  type SpliceEdit,
  type SplicedSource,
} from '../spliced-content.ts';
import {
  appendMembers,
  indentStyleOf,
  indentsFor,
  renderMember,
  renderValue,
  scanCardSource,
  type CardSourceLayout,
  type StoredContainer,
} from './json-splice.ts';
import {
  OperationFailure,
  isOperationFailure,
  type OperationDefinition,
  type EntryPosition,
  type OperationErrorCode,
  type OperationProgram,
} from './types.ts';
import {
  OperationReadTally,
  emitOperationPerf,
  type OperationDiagnostics,
  type OperationMissingReason,
  type OperationOutcome,
} from './telemetry.ts';
import type { LooseSingleCardDocument } from '../index.ts';
import { rri, type RealmResourceIdentifier } from '../realm-identifiers.ts';
import type { OperationTemplate } from './types.ts';

// ============================================================================
// The `create`, `update` and `delete` executors.
//
// Each one is a pure staging function: it reads the batch's pre-loaded state,
// works out the exact bytes every file it touches should end up holding, and
// returns them. It writes nothing, enqueues nothing and broadcasts nothing.
// That is what makes an all-or-nothing batch possible — every entry is
// validated and resolved in memory first, so an entry that cannot be carried
// out is found while the realm is still untouched, and the batch is abandoned
// with nothing to undo.
//
// The staging is where the work is, not a formality. A create decides the new
// card's URL and directory, resolves the links it declares, and serializes the
// document against its type's definition. An update reads the stored file,
// merges the patch over it under the rules below, and serializes the result. A
// delete establishes that its target is there to remove. All three can refuse,
// and a refusal is an `OperationFailure` carrying the status the caller sees.
// ============================================================================

// The identity of a card the batch is creating: the URL it will answer to, and
// the file its bytes land in. Both are known before anything is written, which
// is what lets one entry link to a card another entry in the same batch mints.
export interface StagedIdentity {
  id: string;
  path: LocalPath;
}

// Every card the batch mints, keyed by the `lid` the client named it with. A
// `lid` is the client's own id for a card that does not exist yet, and it is
// the only way one entry can refer to another's card, so this is the single
// place a `lid` resolves — the file path a create writes and the link another
// entry records both read the identity from here, so the two cannot disagree.
export type LidIndex = ReadonlyMap<string, StagedIdentity>;

// A file's stored state, read once inside the write lock before any executor
// runs. The merge base for an update is these bytes rather than the index: the
// index is downstream of the file and can lag it, so merging over indexed
// state would silently revert every field indexing has not caught up on.
export interface StoredFile {
  content: string;
  lastModified: number;
  // A fingerprint of the bytes above, computed when they were read inside the
  // write lock — the version a caller's `baseVersion` is compared against.
  // Never the file's recorded row, which can name a version the bytes no
  // longer hold; `readStoredFiles` has the reason.
  contentHash: string;
}

// What the batch knows about a stored file it never read: that it is there,
// and which version it holds. Kept apart from `StoredFile` rather than folded
// into it as an optional member, because the difference is the point — a
// change that replaces a file's content wholesale has no merge base, so an
// executor working from one of these has nothing to merge over and cannot
// quietly come to depend on bytes that are not there. There is no modification
// time here for the same reason there are no bytes: the one a result reports
// is the one the commit produced, so the one the file carried before it is of
// no use to anything.
//
// The fingerprint is the same value hashing the whole file would produce,
// assembled from bounded reads instead (`computeContentHashFromRanges` states
// why the two agree), so a caller can compare a `baseVersion` against it
// whatever the file's size.
export interface StoredMeta {
  contentHash: string;
}

// What the index can say about a card, narrowed to the values a program reads
// from it.
//
// Both are snapshots the indexer produced, so both lag the card's stored file
// and both are absent until it has been indexed at all — which is the whole
// reason they are kept apart from the stored document rather than merged into
// it. Each carries the card's own stored fields alongside the ones only it can
// answer, and that is fine: an overlay answers only where the stored document
// holds nothing.
export interface IndexedCardValues {
  // `pristine_doc`: the card's own document with its computed fields filled
  // in, as the JSON:API resource the index stores. Handed over whole rather
  // than as its attributes, because a computed *link* is a relationship — it
  // is never in `attributes`, and every card has one in `cardTheme`. The
  // executor projects it into the shape a program reads before laying it
  // over, using the same projection the stored document goes through, so the
  // two describe a path the same way.
  pristine: CardResource | undefined;
  // `search_doc`: the card's searchable fields, with each `searchable` link's
  // target expanded in place.
  searchDoc: Record<string, unknown> | undefined;
}

// A stored file read in bounded pieces rather than whole: its byte length, and
// a reader for `[start, end)`. What an executor works from when the file is
// large enough that reading it is the cost to avoid.
export interface SourceBytes {
  size: number;
  read(start: number, end: number): AsyncIterable<Uint8Array>;
}

// A JSON:API card document as a batch entry carries it. `included` side-loads
// cards to create alongside the primary, each linked to it by its `lid`.
export interface BatchDocument {
  data: CardResource;
  included?: CardResource[];
}

interface EntryCommon {
  // The position this entry holds in whatever the caller composed it from,
  // where that is not its position in the batch. A transport that stages only
  // some of what it was sent — an envelope holding reads alongside writes —
  // hands over a shorter list, so a refusal naming the position in this batch
  // would name an entry the caller did not send. Every position the batch
  // reports comes from here when it is set: the key on the error, the one
  // beside it naming a conflicting entry, and the prose.
  label?: EntryPosition;
  // The lowered operation, when the entry invokes a named operation rather
  // than a plain base one. A named `create` stages its card from the
  // definition's `of` and `fill` instead of from a document.
  definition?: OperationDefinition;
  // The payload, keyed as the definition's `params` schema declares it.
  params?: Record<string, unknown>;
  // The version the caller believes it is writing on top of. Present makes
  // the write conditional in the reporting sense: the result says whether the
  // target was still at that version, and the write happens either way.
  baseVersion?: string;
}

export interface CreateEntry extends EntryCommon {
  op: 'create';
  // The client's own id for the card being minted. It names the file the card
  // lands in, and it is the key other entries in the batch link to it by.
  // Absent means the realm mints an id, and nothing else in the batch can
  // refer to the card.
  lid?: string;
  // The card the create is anchored on, for a named create whose template
  // reads it through `instance(…)`.
  href?: string;
  // A raw JSON:API document, as a `POST` carries it.
  document?: BatchDocument;
  // The realm-relative directory the new card's type directory sits under.
  // Absent means the realm root, which is where a `POST` to the realm itself
  // creates cards.
  directory?: string;
}

// Replace what is stored at the target. Two targets take an update and they
// take different payloads: a card is patched with a JSON:API `document`, which
// is merged over its stored document; a file's content is replaced wholesale
// by `content`, since a file's metadata is derived from its bytes and there is
// no document to merge. Which one an entry means is read off which of the two
// it carries, so a caller never has to name the target's kind and the realm
// never has to guess it from a URL.
export interface UpdateEntry extends EntryCommon {
  op: 'update';
  // The card being patched, or the file being replaced, as an absolute URL.
  href: string;
  document?: BatchDocument;
  // The file's new content. Text through the operations envelope; raw bytes
  // when the facade dispatches an upload, which is why the two spellings are
  // one member rather than a text one and a binary one.
  content?: string | Uint8Array;
  // Replace the bytes stored at the target verbatim, whatever they are — the
  // one way an update reaches a module's source, a card's stored `.json`, or a
  // path that holds nothing yet.
  //
  // It exists for the realm's two file-write routes, the `card+source` `POST`
  // and the binary upload, which put the bytes they are given at the path they
  // are given and have to keep doing so once they dispatch through this
  // operation. Nothing on the envelope path sets it: through the envelope an
  // update on a card is the JSON:API merge above, and one on a module is
  // refused — a client that could ask for a verbatim replacement of a card's
  // source could write bytes that are no longer a card and leave the realm to
  // find out at index time.
  rawSource?: true;
  // Stage the serialized merge even when the patch changes nothing, instead
  // of leaving the file exactly as it is. What that buys is a rewrite in
  // canonical serialized form for a card stored in any other form, and a
  // rewrite is what puts the card in front of the indexer again.
  //
  // It is how a caller that has looked for the card in the index and not
  // found it asks for that: the card+json `PATCH` sets it when the row it
  // reads back is missing or an error, which is why patching a card the index
  // has never seen stores it and indexes it rather than reporting that it
  // cannot be read. Nothing on the envelope path sets it — a batch reports
  // the version a card holds and never reads the row that would justify it.
  reserialize?: true;
}

// Add one line to the end of a text file, without reading what is already
// there. The line arrives under `params.line`, which is where a declaration's
// `line` param and an `input` program that shapes one both put it.
export interface AppendLineEntry extends EntryCommon {
  op: 'appendLine';
  // The file being appended to, as an absolute URL. A file's URL is its path:
  // nothing is appended to it to find the file, the way a card's `.json` is.
  href: string;
}

export interface DeleteEntry extends EntryCommon {
  op: 'delete';
  href: string;
}

// Run a BXL program over the target's stored JSON:API document.
export interface TransformEntry extends EntryCommon {
  op: 'transform';
  // The card the program runs against, as an absolute URL.
  href: string;
  // The program, for an entry invoking the base behavior rather than a named
  // operation — the raw form, whose author writes the BXL out. A named
  // operation's program comes from its declaration and is never read from
  // here; `programFor` has the reason.
  program?: OperationProgram;
  // The name the operation was invoked under. It is what an author reads the
  // operation by, so it is what the telemetry line and every refusal name.
  // Absent for the base behavior, which is invoked as `transform`.
  name?: string;
}

// Add items to one or more of the target's `containsMany` fields. The members
// are spelled as the operations envelope spells them in an entry's `data`, so
// the endpoint hands them straight through.
export interface AppendContainsManyEntry extends EntryCommon {
  op: 'appendContainsMany';
  // The card being appended to, as an absolute URL.
  href: string;
  // The field to append to and the items bound for it.
  field?: string;
  items?: unknown[];
  // Or several fields at once, each with its own items. A field appears in
  // one spelling or the other, never both.
  fields?: Record<string, unknown[]>;
}

export type BatchEntry =
  | CreateEntry
  | UpdateEntry
  | DeleteEntry
  | TransformEntry
  | AppendContainsManyEntry
  | AppendLineEntry;

// One file the batch will write, and the content it will hold — either the
// bytes themselves, or a description of them for a change that never
// materialized the file it edits.
export interface StagedWrite {
  path: LocalPath;
  content: StagedContent;
}

export type StagedContent = string | Uint8Array | SplicedSource;

// Content one entry adds to the end of a file. Distinct from a write because
// what it names is not the file's next content but an addition to it: the
// entry that staged one never read the file and could not say what its content
// will be, and two of them aimed at one file both land rather than the second
// standing in for the first.
//
// Text, where the adapter primitive underneath takes bytes as well: the one
// behavior that stages an append appends a line to a text file, and refuses
// anything whose content type says otherwise.
export interface StagedAppend {
  path: LocalPath;
  content: string;
}

// What one executor stages.
export interface StagedChange {
  writes: StagedWrite[];
  appends: StagedAppend[];
  deletes: LocalPath[];
  // The files this entry brings into existence, as opposed to the ones it
  // rewrites. A card already stored at one of these is not this entry's to
  // replace, so the coordinator refuses the batch rather than committing over
  // it — the same answer the atomic endpoint gives an `add` whose href is
  // taken.
  mints: LocalPath[];
  // The card the entry's result reports.
  id: string;
  // Echoed on a create, so a client can match the URL the realm minted back to
  // the `lid` it named the card with.
  lid?: string;
  // The file whose post-commit version and modification time the entry's
  // result reports. Absent on a delete — there is no file left to version.
  primaryPath?: LocalPath;
  // Whether this entry's content replaces the file wholesale rather than
  // composing over what is stored there. Two entries changing one card
  // compose, because the later one merges over the bytes the earlier staged;
  // a replacement reads nothing and merges nothing, so a second one on the
  // same path is not a later step in one story — it is the earlier entry's
  // content never landing while that entry reports success.
  replacesContent?: true;
  // Every card this entry records an edge to, as the identity the realm
  // resolved it to. The coordinator holds the batch to not removing one of
  // them, which is the half of "a link points at something" that no single
  // entry can see.
  links?: string[];
  // What running this entry read and how long it took, for the entries that
  // run a program. Reported back on the result so a caller can see which layer
  // answered each of its program's reads without going to the logs.
  diagnostics?: OperationDiagnostics;
}

// What the executors are given. Everything the realm owns arrives already
// done, as a plain value or a bound function: no executor resolves an
// identifier, reads a file, or reaches the network. Card modules are
// author-written and the realm is a trusted context, so steering a lookup is
// not something an operation gets to do.
export interface StagingContext {
  realmURL: string;
  paths: RealmPaths;
  lids: LidIndex;
  // The local ids a side-load claimed for another realm. They name no card
  // this batch writes, so a link to one resolves to nothing — this is what
  // tells that from a link to an id nobody sent.
  foreignLids: ReadonlySet<string>;
  // What such a link means, which is the caller's to say: see
  // `CommitBatchOptions.foreignSideLoadLink`. Absent reads as `refuse`.
  foreignSideLoadLink?: 'refuse' | 'leave';
  // Every target's stored file, keyed by local path, read inside the write
  // lock before any executor runs.
  stored: ReadonlyMap<LocalPath, StoredFile>;
  // What the batch knows about the targets it read the version of rather than
  // the bytes of — a file whose content an entry replaces wholesale. Read
  // inside the same lock and, like `stored`, kept in step as entries compose.
  storedMeta: ReadonlyMap<LocalPath, StoredMeta>;
  // What an earlier entry staged for a file it described rather than read. An
  // append composes over this so two appends to one card both land, and it is
  // what tells an executor that needs the bytes whole that it cannot have
  // them.
  splices: ReadonlyMap<LocalPath, SplicedSource>;
  // A stored file as a size and a bounded reader, for an executor that edits
  // bytes it must not hold. Undefined when nothing is stored at the path.
  openSourceBytes(localPath: LocalPath): Promise<SourceBytes | undefined>;
  // Whether anything is stored at a path, which two executors ask for
  // different reasons. It is what makes a card exist for a link to point at —
  // the file is the card, and its index row is only the realm's reading of it
  // — and it is the only question an append may ask about its own target,
  // since establishing that a file is there costs a stat while opening it is
  // the cost an append exists without.
  fileExists(localPath: LocalPath): Promise<boolean>;
  // The index's view of a card in this realm, narrowed to the two documents a
  // program reads values from. Undefined where the index holds no clean row
  // for the URL, which is what makes those values unavailable rather than
  // empty.
  indexedCardValues(url: URL): Promise<IndexedCardValues | undefined>;
  // The invoking actor, as the identity `actor()` resolves to. It comes from
  // the authenticated realm user the request's permission check verified, and
  // is supplied by the endpoint that verified it — an executor never derives
  // an actor itself.
  actor: string;
  // The settings of the realm being written, as `realmConfig()` resolves them.
  // A function because most batches never ask: reading them is a parse of the
  // realm's config document, and nothing should pay for it to stage a card
  // that names no setting. It answers the same map however often it is called,
  // so every entry in the batch reads one snapshot.
  //
  // The map is always there to be read, empty for a realm that declares none:
  // a program naming a setting is told this realm has no such setting rather
  // than that nothing supplied a configuration, and those are two different
  // defects.
  realmConfig(): Promise<Record<string, JsonValue>>;
  // A card document serialized for storage: the bytes the file holds, with
  // every field resolved against the type's definition.
  serializeCard(
    doc: LooseSingleCardDocument,
    relativeTo: URL,
  ): Promise<LooseSingleCardDocument>;
  // A code ref's canonical key, for comparing two refs that name the same
  // type through different spellings.
  codeRefKey(codeRef: CodeRef, relativeTo: URL): string;
  // A module identifier resolved against another, for the module refs a
  // side-loaded resource carries relative to the card it was sent with.
  resolveModuleId(
    moduleId: RealmResourceIdentifier,
    relativeTo: string,
  ): RealmResourceIdentifier;
  // A relationship's `links.self` as the realm stores it: a link inside the
  // writing realm is recorded relative to the file that holds it, so a realm
  // that is cloned or served under another host keeps linking within itself.
  // Resolving one needs the realm's fetch layer, which no executor reaches, so
  // it arrives bound — the same reason `resolveModuleId` and `codeRefKey` do.
  storedLink(selfLink: string, relativeTo: URL): string;
  // The inverse: the card a stored `links.self` names. A program compares and
  // rewrites card identities, so the stored spelling — relative inside this
  // realm, a scoped reference outside it — is resolved before the program sees
  // one.
  resolvedLink(selfLink: string, relativeTo: URL): string;
  // The definition-cache entry for a type, or undefined when it cannot be
  // read.
  lookupDefinition(
    codeRef: CodeRef,
    relativeTo: URL,
  ): Promise<Definition | undefined>;
}

// ---------------------------------------------------------------------------
// `create`
// ---------------------------------------------------------------------------

export async function stageCreate(
  entry: CreateEntry,
  ctx: StagingContext,
): Promise<StagedChange> {
  let primary = await primaryCreateResource(entry, ctx);
  if (namesForeignRealm(primary, ctx.realmURL)) {
    throw new OperationFailure({
      status: 400,
      code: 'invalid-params',
      title: 'Invalid target',
      detail:
        `a create names realm ${primary.meta.realmURL}, which is not ` +
        `${ctx.realmURL}; a batch commits to one realm`,
    });
  }
  let identity = createIdentity(entry, primary, ctx.paths, ctx.lids);
  promoteStagedLinks(primary, ctx);
  let writes: StagedWrite[] = [
    {
      path: identity.path,
      content: await serializeForStorage(primary, identity, ctx),
    },
  ];
  for (let resource of includedResources(entry.document)) {
    // A side-loaded resource with no `lid` is not staged: it has no id to be
    // created under and nothing in the batch can link to it, so the client
    // sent a resource the realm has no way to name. One naming another realm
    // is not this batch's to write.
    if (
      typeof resource.lid !== 'string' ||
      namesForeignRealm(resource, ctx.realmURL)
    ) {
      continue;
    }
    // A create's side-load keeps the module references it was sent with.
    // Resolving them against the primary would resolve them against a card
    // one directory deep, which is not where the side-load lands and not
    // what a caller writing them meant.
    writes.push(await stageSideLoaded(resource, resource.lid, undefined, ctx));
  }
  let lid = localIdOf(entry);
  return {
    writes,
    appends: [],
    deletes: [],
    mints: writes.map((write) => write.path),
    id: identity.id,
    ...(lid ? { lid } : {}),
    primaryPath: identity.path,
  };
}

// The local id a create entry is named by. A raw JSON:API create carries it on
// the resource, the way a `POST` body does; an entry may also name it
// directly. Read through one function so both spellings name the same card —
// otherwise a payload naming its card only on the resource is minted under a
// generated id, and every relationship elsewhere in the batch pointing at that
// local id resolves to nothing.
export function localIdOf(entry: CreateEntry): string | undefined {
  if (typeof entry.lid === 'string') {
    return entry.lid;
  }
  let resourceLid = entry.document?.data?.lid;
  return typeof resourceLid === 'string' ? resourceLid : undefined;
}

// The side-loaded resources a document carries, held to the shape the card
// endpoints require of one: a list, of card resources. A malformed side-load
// is the caller's payload to fix, so it is refused here rather than reaching
// the serializer as an internal failure.
export function includedResources(
  document: BatchDocument | undefined,
): CardResource[] {
  let included = document?.included;
  if (included === undefined) {
    return [];
  }
  if (!Array.isArray(included)) {
    throw new OperationFailure({
      status: 400,
      code: 'invalid-params',
      title: 'Invalid document',
      detail: `"included" is not an array`,
    });
  }
  for (let resource of included) {
    if (!isCardResource(resource)) {
      throw new OperationFailure({
        status: 400,
        code: 'invalid-params',
        title: 'Invalid document',
        detail: `a side-loaded resource is not a valid card resource`,
      });
    }
  }
  return included;
}

// A card side-loaded alongside the one an entry names. `relativeTo` is the
// card its module references were written against, when there is one: an
// update's side-load is sent alongside a stored card and names modules
// relative to it, while a create's is sent alongside a card that does not
// exist yet and names them for itself.
async function stageSideLoaded(
  sent: CardResource,
  lid: string,
  relativeTo: string | undefined,
  ctx: StagingContext,
): Promise<StagedWrite> {
  let identity = stagedLid(lid, ctx);
  // Rewritten on a copy. Staging is what makes a batch abandonable, and a
  // rewrite in place would leave the caller's own document carrying resolved
  // links and absolutized modules after a batch that committed nothing —
  // state a retry of the same entries would then stage on top of.
  let resource = cloneDeep(sent);
  promoteStagedLinks(resource, ctx);
  if (relativeTo !== undefined) {
    visitModuleDeps(resource, (moduleId, setModuleId) => {
      setModuleId(ctx.resolveModuleId(moduleId, relativeTo));
    });
  }
  return {
    path: identity.path,
    content: await serializeForStorage(resource, identity, ctx),
  };
}

// The resource a create stages: the document the caller sent, or the one a
// named create's `of` + `fill` template describes.
async function primaryCreateResource(
  entry: CreateEntry,
  ctx: StagingContext,
): Promise<CardResource> {
  if (entry.document) {
    if (!isCardResource(entry.document.data)) {
      throw new OperationFailure({
        status: 400,
        code: 'invalid-params',
        title: 'Invalid document',
        detail: `a create's document is not a valid card resource`,
      });
    }
    return cloneDeep(entry.document.data);
  }
  if (entry.definition?.of) {
    return await resourceFromTemplate(entry, entry.definition, ctx);
  }
  throw new OperationFailure({
    status: 400,
    code: 'invalid-params',
    title: 'Nothing to create',
    detail:
      `a create needs either a card document or an operation declaring the ` +
      `type it mints`,
  });
}

// ---------------------------------------------------------------------------
// `update`
// ---------------------------------------------------------------------------

export async function stageUpdate(
  entry: UpdateEntry,
  ctx: StagingContext,
): Promise<StagedChange> {
  let url = targetURL(entry.href);
  if (entry.content !== undefined) {
    if (entry.document !== undefined) {
      throw new OperationFailure({
        id: url.href,
        status: 400,
        code: 'invalid-params',
        title: 'Invalid document',
        detail:
          `an update carries the patch to apply to a card or the content to ` +
          `replace a file with, and this one carries both`,
      });
    }
    return await stageFileUpdate(entry, entry.content, url, ctx);
  }
  if (entry.rawSource) {
    throw new OperationFailure({
      id: url.href,
      status: 400,
      code: 'invalid-params',
      title: 'Invalid document',
      detail:
        `an update that replaces the stored bytes verbatim carries the ` +
        `content to replace them with, and this one carries none`,
    });
  }
  let localPath = localPathIn(url, ctx);
  let sourcePath = `${localPath}.json` as LocalPath;
  if (ctx.splices.has(sourcePath)) {
    // An earlier entry appended to this card without reading it, so the bytes
    // it staged exist only as a description. A patch merges over the card's
    // stored state, which would mean materializing exactly the document the
    // append avoided — and committing without merging would drop the append
    // with nothing said. So the pair is refused, and the two changes are sent
    // as separate batches.
    throw new OperationFailure({
      id: url.href,
      status: 400,
      code: 'invalid-params',
      title: 'Conflicting entries',
      detail:
        `an earlier entry appends to ${url.href} without reading it, so a ` +
        `patch in the same batch has no stored state to merge over`,
    });
  }
  let stored = ctx.stored.get(sourcePath);
  if (!stored) {
    throw new OperationFailure({
      id: url.href,
      status: 404,
      code: 'target-not-found',
      title: 'Not found',
      detail: `${url.href} does not exist in realm ${ctx.realmURL}`,
    });
  }
  let original = storedResource(stored.content, url);
  if (!entry.document?.data) {
    throw new OperationFailure({
      id: url.href,
      status: 400,
      code: 'invalid-params',
      title: 'Invalid document',
      detail: `an update carries the patch to apply, and this one carries none`,
    });
  }
  let patch = cloneDeep(entry.document.data);
  if (!isCardResource(patch)) {
    throw new OperationFailure({
      id: url.href,
      status: 400,
      code: 'invalid-params',
      title: 'Invalid document',
      detail: `the patch for ${url.href} is not a card document`,
    });
  }
  // A card's type is fixed for its life: an instance of another type is
  // another card, so changing it is a create and a delete rather than a
  // patch.
  if (
    original.meta?.adoptsFrom &&
    ctx.codeRefKey(patch.meta.adoptsFrom, url) !==
      ctx.codeRefKey(original.meta.adoptsFrom, url)
  ) {
    throw new OperationFailure({
      id: url.href,
      status: 400,
      code: 'invalid-params',
      title: 'Cannot change type',
      detail: `cannot change card instance type to ${JSON.stringify(
        patch.meta.adoptsFrom,
      )}`,
    });
  }
  let included = includedResources(entry.document);
  // What follows — down to the bytes this stages — is the merge a card's
  // `PATCH` applies. It is the only copy of it: the endpoint dispatches
  // through here, so a patch sent over HTTP and one sent as a batch entry
  // land the same bytes because they are the same code.
  //
  // Realm-managed keys never come from a patch: `realmInfo` and `realmURL` are
  // stamped by the realm serving the card, `screenshots` is joined from the
  // prerendered manifest at serve time, `version` is the fingerprint the
  // commit computed over the bytes it stored, and `type` is fixed by the
  // document shape. A client echoing back what it was served must not persist
  // any of them into the source file.
  //
  // Dropped here and not only where the bytes are serialized, because these
  // run ahead of the unchanged-patch comparison below. A key that survives the
  // merge makes a patch that changes nothing look like a change — rewriting
  // the file, moving its modification time, queueing an index pass, and
  // reporting `changed` — none of which stripping it afterwards undoes.
  delete (patch as { type?: unknown }).type;
  delete patch.meta.realmInfo;
  delete patch.meta.realmURL;
  delete patch.meta.screenshots;
  delete patch.meta.version;

  promoteStagedLinks(patch, ctx);

  // A patch that fully replaces an array attribute makes that array's
  // per-index field metadata stale — the polymorphic type recorded at
  // `meta.fields['items.1']`, or the array-valued `meta.fields['items']` of a
  // composite containsMany. The merge below overwrites arrays in `attributes`
  // but deep-merges `meta.fields`, so the removed element's metadata would
  // otherwise survive and be re-applied to a new entry when the array grows
  // again. Dropping it from the original first lets the patch's own metadata
  // win cleanly.
  let merged = cloneDeep(original);
  clearReplacedArrayFieldMeta(merged.meta, patch.attributes);
  let primary = mergeWith(merged, patch, (_target, source: unknown) =>
    // A patched array replaces the original rather than merging into it —
    // merging would make removing an item impossible.
    Array.isArray(source) ? source : undefined,
  );
  if (primary.relationships || patch.relationships) {
    let mergedRelationships = mergeRelationships(
      primary.relationships,
      patch.relationships,
    );
    if (mergedRelationships && Object.keys(mergedRelationships).length !== 0) {
      primary.relationships = mergedRelationships;
    }
  }

  let writes: StagedWrite[] = [];
  if (
    included.length === 0 &&
    !entry.reserialize &&
    isEqual(primary, original)
  ) {
    // The patch makes no semantic change and side-loads nothing, so the file
    // is left exactly as it is — staging the bytes it already holds is what
    // says so. The commit finds them unchanged, writes nothing, leaves the
    // modification time alone, and queues nothing for indexing, while the
    // entry's result still reports the version the file holds.
    //
    // Taken unless the caller asked for the merge to be staged regardless. A
    // batch cannot decide on its own that an unchanged card wants indexing
    // again, because that would mean reading the index row of the very card
    // being changed, which no executor reads — the index is downstream of the
    // file and can lag it, which is the whole reason the merge base is the
    // bytes. (A type's definition is a different read: it describes the type
    // rather than the card, and is what serialization needs to resolve fields
    // at all.) So that judgment stays with the caller holding the row, and
    // `reserialize` is what it asks with.
    writes.push({ path: sourcePath, content: stored.content });
  } else {
    // The id lives in the file's name, not in its contents.
    delete primary.id;
    writes.push({
      path: sourcePath,
      content: await serializeForStorage(
        primary,
        { id: url.href, path: sourcePath },
        ctx,
      ),
    });
    for (let resource of included) {
      if (
        typeof resource.lid !== 'string' ||
        namesForeignRealm(resource, ctx.realmURL)
      ) {
        continue;
      }
      writes.push(await stageSideLoaded(resource, resource.lid, url.href, ctx));
    }
  }
  return {
    writes,
    appends: [],
    deletes: [],
    // Nothing here is a mint. The primary rewrites a card that is already
    // there, and a side-load addressed by a local id the caller chose may
    // name a card it is deliberately rewriting — which is what a `PATCH`
    // carrying the same side-load does. Refusing it here would make a batch
    // answer 409 where the handler it mirrors succeeds.
    mints: [],
    id: url.href,
    primaryPath: sourcePath,
  };
}

// ---------------------------------------------------------------------------
// `update` on a file
// ---------------------------------------------------------------------------

// Replace a file's content wholesale.
//
// A file's URL is its path — nothing is appended to it to find the bytes, the
// way a card's `.json` is — and its metadata is derived from those bytes and
// read-only, so there is no document to merge and nothing to serialize: what
// the caller sends is what the file holds.
//
// Two stored things are addressed by their own path and are not files in this
// sense: a module's source, and a card's stored `.json`. Both are refused,
// because a caller replacing either wholesale through the operations envelope
// would be writing bytes the realm serves as code or as a card while saying it
// was changing a file — a card's update is the JSON:API merge, and a module's
// source has no update at all. `rawSource` is how the callers that must reach
// them say so: the realm's two file-write routes, the `card+source` `POST` and
// the binary upload, which write exactly those today and keep writing them
// once they dispatch through here.
async function stageFileUpdate(
  entry: UpdateEntry,
  content: string | Uint8Array,
  url: URL,
  ctx: StagingContext,
): Promise<StagedChange> {
  let path = localPathIn(url, ctx);
  let refuse = (detail: string): never => {
    throw new OperationFailure({
      id: url.href,
      status: 405,
      code: 'operation-not-allowed',
      title: 'Operation not allowed',
      detail,
    });
  };
  if (ctx.splices.has(path)) {
    // An earlier entry edited this file without reading it, staging bytes that
    // exist only as a description. Replacing them wholesale would drop that
    // entry's change while it still reported success, so the pair is refused
    // and the two changes are sent as separate batches.
    throw new OperationFailure({
      id: url.href,
      status: 400,
      code: 'invalid-params',
      title: 'Conflicting entries',
      detail:
        `an earlier entry changes ${url.href} without reading it, so its ` +
        `change would be lost by a replacement in the same batch`,
    });
  }
  let stored = ctx.stored.get(path);
  let meta = stored ?? ctx.storedMeta.get(path);
  if (!entry.rawSource) {
    if (hasExecutableExtension(path)) {
      refuse(
        `${url.href} is a module; its source is replaced through the ` +
          `card source endpoint, not by an update on a file`,
      );
    }
    if (stored && isSingleCardDocument(parsed(stored.content))) {
      // A single card document and nothing wider. A `.json` holding a JSON:API
      // *collection* is stored and served as a file and never becomes an
      // instance row — the realm says so itself where it decides whether a
      // path is a card awaiting its first index — so refusing a replacement of
      // one as "a card's source" would contradict what the realm does with it
      // everywhere else. The write ceiling classifies the two together, which
      // is a different question: how many bytes the realm will store.
      refuse(
        `${url.href} holds a card's stored source; an update on a card is ` +
          `the merge its document describes, not a replacement of its bytes`,
      );
    }
    if (!meta && (await ctx.fileExists(`${path}.json` as LocalPath))) {
      // The URL names a card rather than a file, so there are no bytes at it
      // to replace. Said as a refusal rather than as "nothing is there",
      // because something is: the caller reached a card with a file's payload
      // and its remedy is to send the patch, not to look elsewhere.
      refuse(
        `${url.href} names a card; an update on one carries the patch to ` +
          `apply rather than the content to replace it with`,
      );
    }
  }
  if (!meta && !entry.rawSource) {
    // Creating a file is not an operation — the realm's write routes own
    // that — so an update has a file to replace or it has nothing to do. A
    // verbatim replacement is the exception, since the routes it stands in
    // for create the files they write.
    throw new OperationFailure({
      id: url.href,
      status: 404,
      code: 'target-not-found',
      title: 'Not found',
      detail: `${url.href} does not exist in realm ${ctx.realmURL}`,
    });
  }
  return {
    writes: [{ path, content }],
    appends: [],
    deletes: [],
    // A file already stored here is being replaced, and one that is not is
    // being written by the endpoint that creates files. Neither is a mint in
    // the sense the batch refuses — that is a create claiming a path a card
    // already answers to.
    mints: [],
    id: url.href,
    primaryPath: path,
    replacesContent: true,
  };
}

// ---------------------------------------------------------------------------
// `appendLine`
// ---------------------------------------------------------------------------

// Add one newline-terminated line to the end of a text file.
//
// Nothing here reads the target. That is the whole of why the behavior exists:
// a log, a ledger, an audit trail is appended to far more often than it is
// read, and expressing that as an update means holding the file's content to
// produce the content it should hold next — so adding a line to a file of a
// hundred megabytes costs a hundred megabytes. What is staged is the line, and
// the realm's adapter adds it at the end of the file without reading it.
//
// So every check below is one that can be made without the bytes: what the
// file's name says it holds, and whether anything is stored at the path, which
// is a stat rather than a read.
export async function stageAppendLine(
  entry: AppendLineEntry,
  ctx: StagingContext,
): Promise<StagedChange> {
  let url = targetURL(entry.href);
  let path = localPathIn(url, ctx);
  let line = entry.params?.line;
  if (typeof line !== 'string') {
    throw new OperationFailure({
      id: url.href,
      status: 400,
      code: 'invalid-params',
      title: 'Invalid line',
      detail:
        `an appendLine appends the line its payload carries under \`line\`, ` +
        `and this one carries ${line === undefined ? 'none' : 'something that is not a string'}`,
    });
  }
  if (/[\n\r]/.test(line)) {
    // The terminator is the operation's to add, so a line carrying one of its
    // own would append two lines under one call — and the result's version
    // would describe a file the caller did not ask for. One call, one line.
    throw new OperationFailure({
      id: url.href,
      status: 400,
      code: 'invalid-params',
      title: 'Invalid line',
      detail:
        `the line to append contains a line break; one call appends one ` +
        `line, and the terminator is added for it`,
    });
  }
  let refuse = (detail: string): never => {
    throw new OperationFailure({
      id: url.href,
      status: 405,
      code: 'operation-not-allowed',
      title: 'Operation not allowed',
      detail,
    });
  };
  // Asked first, ahead of the checks the name alone settles, because a card's
  // URL carries no extension and would otherwise be turned away as binary
  // content — which is the right answer given in terms that describe nothing
  // the caller sent.
  if (await ctx.fileExists(`${path}.json` as LocalPath)) {
    refuse(
      `${url.href} names a card, whose stored source is a JSON document; a ` +
        `line appended to one leaves bytes that are no longer a card`,
    );
  }
  // Classified by name, which is what the realm serves the file's content type
  // from, so the operation refuses exactly what a reader of the file would be
  // told it is getting. An unknown extension resolves to a binary type and is
  // refused with them, which is the byte-preserving side to be wrong on.
  let contentType = inferContentType(path);
  if (isBinaryContentType(contentType)) {
    refuse(
      `${url.href} holds ${contentType}, and a line of text appended to ` +
        `binary content is not a line of anything`,
    );
  }
  if (isJSONContentType(contentType)) {
    // Text, but text whose shape a trailing line destroys: what follows a JSON
    // document's closing brace is no longer a JSON document. A card's stored
    // source addressed by its own path is the case that matters most, and it
    // is the same objection for every other stored JSON, so the content type
    // answers for all of them.
    refuse(
      `${url.href} holds ${contentType}, and a line appended after a JSON ` +
        `document leaves bytes that are no longer one`,
    );
  }
  if (hasExecutableExtension(path)) {
    // Text as well, and appendable without breaking it — but a module is
    // source the realm evaluates, and an operation meant for a log line is not
    // how code is edited.
    refuse(
      `${url.href} is a module; its source is changed through the card ` +
        `source endpoint, not by appending a line`,
    );
  }
  // An earlier entry may have staged this file's content without it being on
  // disk yet — a verbatim source write creates the file it writes — which is
  // as good as stored for an append that lands after it in the same commit.
  let staged = ctx.stored.has(path) || ctx.storedMeta.has(path);
  if (!staged && !(await ctx.fileExists(path))) {
    // Appending to a path holding nothing would create the file, and creating
    // a file is not an operation.
    throw new OperationFailure({
      id: url.href,
      status: 404,
      code: 'target-not-found',
      title: 'Not found',
      detail: `${url.href} does not exist in realm ${ctx.realmURL}`,
    });
  }
  return {
    writes: [],
    appends: [{ path, content: `${line}\n` }],
    deletes: [],
    mints: [],
    id: url.href,
    primaryPath: path,
  };
}

// ---------------------------------------------------------------------------
// `delete`
// ---------------------------------------------------------------------------

export function stageDelete(
  entry: DeleteEntry,
  ctx: StagingContext,
): StagedChange {
  let url = targetURL(entry.href);
  let localPath = localPathIn(url, ctx);
  let sourcePath = `${localPath}.json` as LocalPath;
  // The stored file decides whether there is a card here, for the same reason
  // an update merges over it: a card written a moment ago is on disk before it
  // is in the index, and refusing to delete it until indexing catches up would
  // make a client unable to remove what it just created.
  let stored = ctx.stored.get(sourcePath);
  if (!stored) {
    throw new OperationFailure({
      id: url.href,
      status: 404,
      code: 'target-not-found',
      title: 'Not found',
      detail: `${url.href} does not exist in realm ${ctx.realmURL}`,
    });
  }
  // A `.json` file on disk is not by itself a card — a hand-written config,
  // a fixture, anything the realm stores but does not serve as one. The bytes
  // already read answer this, so the check costs no read and keeps the
  // just-written card above deletable, which asking the index would not. This
  // is the answer `DELETE` gives for the same URL, where it is the index
  // rather than the bytes that reports no card there.
  //
  // `realm.json` is not covered by this and is not meant to be: a realm's
  // config is itself a card document, and `DELETE` removes it too. Refusing
  // it here would put the batch out of step with the endpoint rather than
  // protecting anything the endpoint protects.
  if (!cardResourceIn(stored.content)) {
    throw new OperationFailure({
      id: url.href,
      status: 404,
      code: 'target-not-found',
      title: 'Not found',
      detail: `${url.href} is not a card in realm ${ctx.realmURL}`,
    });
  }
  return {
    writes: [],
    appends: [],
    deletes: [sourcePath],
    mints: [],
    id: url.href,
  };
}

// ---------------------------------------------------------------------------
// `transform`
// ---------------------------------------------------------------------------

// BXL, and the shape of what this module asks of it.
//
// Stated here rather than imported, and loaded through a specifier TypeScript
// cannot follow, because reaching for `@cardstack/bxl` at all — for a value or
// for a type — pulls its sources into the typecheck program of every package
// that reaches an executor. `packages/postgres` gets here through
// `runtime-common/realm`, and compiles those sources under an older `lib` than
// they are written for. Keeping BXL out of the static graph keeps a dependency
// of this one behavior from becoming a dependency of everything upstream of
// it.
//
// `bxl-mirror-check.ts` holds these shapes against the real ones. It imports
// bxl and nothing imports it, so the check runs in this package's own
// typecheck and reaches no consumer.
export type OverlayTier = 'computed' | 'linked';

export interface UnavailableOverlay {
  path: string;
  tier: OverlayTier;
  reason: OperationMissingReason;
}

export interface ProgramOverlays {
  computeds?: unknown;
  linked?: unknown;
  unavailable: UnavailableOverlay[];
}

export interface ProgramReadEvent {
  path: string;
  tier: 'source' | OverlayTier;
  outcome: 'value' | 'null' | 'unavailable';
}

export interface ProgramError extends Error {
  phase: string;
  code: string;
  statement: number;
  details?: Record<string, unknown>;
}

export interface ProgramContext {
  params?: Record<string, unknown>;
  actor?: string;
  instance?: Record<string, unknown>;
  realmConfig?: Record<string, JsonValue>;
}

export interface BxlMutationModule {
  isBxlMutationError(err: unknown): err is ProgramError;
  mutationSchemaForCardSource(
    definition: Definition,
    options: {
      lookupDefinition(codeRef: CodeRef): Promise<Definition | undefined>;
    },
  ): Promise<unknown>;
  snapshotBxlCardSource(
    document: { data: CardResource },
    schema: unknown,
    options: {
      targetId?: string;
      resolveReference?: (reference: string) => string;
    },
  ): unknown;
  mutateBxlCardSource(
    document: { data: CardResource },
    source: string,
    options: {
      schema: unknown;
      syntax: 'readable' | 'solidified';
      programId: string;
      targetId?: string;
      context?: ProgramContext;
      overlays?: ProgramOverlays;
      resolveReference?: (reference: string) => string;
      resolveCard?: (id: string) => unknown;
      onRead?: (event: ProgramReadEvent) => void;
    },
  ): { document: { data: CardResource } };
}

// Resolved once per process. The module is pure and stateless, so holding it
// costs one resolution rather than one per program.
let bxlMutation: Promise<BxlMutationModule> | undefined;

function loadBxlMutation(): Promise<BxlMutationModule> {
  // The cast is what keeps the specifier opaque to TypeScript; see above.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  bxlMutation ??= import('@cardstack/bxl/mutation' as string).then(
    (module) => module as BxlMutationModule,
  );
  return bxlMutation;
}

// Change a card by running a BXL program over its stored JSON:API document.
//
// `update` is declarative — here are new values for these fields — and every
// write it makes is knowable from the payload alone. `transform` is relative:
// append this comment, add five to that counter, move this item ahead of that
// one, and do none of it unless the status is still open. What the write turns
// out to be depends on what the card already holds, so the program is planned
// against the stored document and what comes back is a new document rather
// than a patch.
//
// The program is the only author-supplied logic an operation runs, and it is
// BXL rather than JavaScript on purpose: card modules are author-written and
// the realm is a trusted context, so nothing here loads one. The type's shape
// comes from its definition-cache entry, the values come from the stored file
// and the index, and the program itself is data the definition carries.
//
// Three layers can answer a read, and only the first is authoritative. The
// stored document holds the card's own values; the index's `pristine_doc`
// holds its computed ones and its `search_doc` holds the fields of the cards
// it links to, both produced by the indexer and so both able to lag the file
// or be missing outright. `gatherOverlays` is where that is spelled out to
// BXL, which lays the two snapshots *under* the stored document — a stored
// value always wins — and refuses a read of a value the realm said it could
// not supply rather than handing back an absent one.
export async function stageTransform(
  entry: TransformEntry,
  ctx: StagingContext,
): Promise<StagedChange> {
  let url = targetURL(entry.href);
  let name = entry.name ?? 'transform';
  let tally = new OperationReadTally();
  let startedAt = Date.now();
  // Built once and handed to both readers, so what the caller is told and what
  // the channel carries cannot describe the same run differently.
  let describe = (
    outcome: OperationOutcome,
    code?: OperationErrorCode,
  ): OperationDiagnostics => {
    return {
      operation: name,
      base: 'transform',
      target: url.href,
      outcome,
      ...(code ? { code } : {}),
      totalMs: Date.now() - startedAt,
      storedReads: tally.counts.stored,
      computedReads: tally.counts.computed,
      linkedReads: tally.counts.linked,
      missingCount: tally.missing.length,
      missing: [...tally.missing],
    };
  };
  try {
    let staged = await transform(entry, ctx, url, name, tally);
    // Not emitted here. Staging only decides what the bytes would be — the
    // batch can still be abandoned by a later entry, by one of the commit's
    // own checks, or by the write itself, and a line saying `applied` for a
    // file nothing wrote is a line a dashboard cannot correct for. The
    // coordinator emits this record once the commit has landed, which is also
    // what puts the channel and the caller's `meta.diagnostics` on the same
    // population.
    return {
      ...staged.change,
      diagnostics: describe(staged.changed ? 'applied' : 'unchanged'),
    };
  } catch (err: unknown) {
    // A refusal is emitted here, because it is final: this entry produced no
    // staged change, so nothing downstream carries a record for it, and what
    // the program managed to read before it was refused is usually why.
    emitOperationPerf({
      realmURL: ctx.realmURL,
      actor: ctx.actor || null,
      ...describe(
        'refused',
        isOperationFailure(err) ? err.error.code : 'internal-error',
      ),
    });
    throw err;
  }
}

async function transform(
  entry: TransformEntry,
  ctx: StagingContext,
  url: URL,
  name: string,
  tally: OperationReadTally,
): Promise<{ change: StagedChange; changed: boolean }> {
  let sourcePath = `${localPathIn(url, ctx)}.json` as LocalPath;
  if (ctx.splices.has(sourcePath)) {
    // An earlier entry appended to this card without reading it, so the bytes
    // it staged exist only as a description. A program is planned against the
    // whole document, which would mean materializing exactly the document the
    // append avoided — and planning against the pre-append state would drop
    // the append with nothing said. So the pair is refused, and the two
    // changes are sent as separate batches.
    throw new OperationFailure({
      id: url.href,
      status: 400,
      code: 'invalid-params',
      title: 'Conflicting entries',
      detail:
        `an earlier entry appends to ${url.href} without reading it, so a ` +
        `transform in the same batch has no stored document to plan against`,
    });
  }
  let stored = ctx.stored.get(sourcePath);
  if (!stored) {
    throw new OperationFailure({
      id: url.href,
      status: 404,
      code: 'target-not-found',
      title: 'Not found',
      detail: `${url.href} does not exist in realm ${ctx.realmURL}`,
    });
  }
  let program = programFor(entry, url);
  let params = resolvedParams(entry, ctx, url);
  let resource = storedResource(stored.content, url);
  let definition = await transformTargetDefinition(resource, url, ctx);
  let bxl = await loadBxlMutation();
  let schema = await bxl.mutationSchemaForCardSource(definition, {
    lookupDefinition: async (codeRef) =>
      await ctx.lookupDefinition(codeRef, url),
  });
  let fileURL = ctx.paths.fileURL(sourcePath);
  // The index's rendering goes through the same projection the stored document
  // does, so a path means the same thing in both and the overlay lands where
  // the stored document leaves a gap rather than beside it.
  let overlays = await gatherOverlays(
    definition,
    url,
    schema,
    (resource, against) =>
      bxl.snapshotBxlCardSource({ data: resource }, against, {
        targetId: url.href,
        resolveReference: (reference) => ctx.resolvedLink(reference, fileURL),
      }),
    ctx,
  );
  let declaredMissing = overlays.unavailable ?? [];
  // Every card the program says to link to, collected as the planner asks for
  // them. Whether each one is there to link to is a question about this
  // realm's stored state rather than about the program, so it is asked once
  // the program has said which cards it means — nothing is written either
  // way until the whole batch has staged.
  let linked = new Set<string>();
  // Read only for a program that names one, so an ordinary transform does not
  // wait on the realm's config document to stage a card that never asks.
  let realmConfig = programNamesRealmConfig(program.source)
    ? await ctx.realmConfig()
    : undefined;
  let mutated: CardResource;
  try {
    let result = bxl.mutateBxlCardSource({ data: resource }, program.source, {
      schema,
      syntax: program.syntax,
      programId: `${name}:${uuidV4()}`,
      targetId: url.href,
      context: contextFor(params, resource, url, ctx, realmConfig),
      overlays,
      // A relationship is stored relative to the file that holds it, and a
      // program compares and rewrites card identities, so the stored spelling
      // is resolved on the way in. The way out is the realm's own
      // serialization, which spells every link it writes the same way however
      // the write arrived.
      resolveReference: (reference) => ctx.resolvedLink(reference, fileURL),
      resolveCard: (id) => {
        linked.add(id);
        return { id };
      },
      onRead: (event) =>
        tally.record(
          event.path,
          event.tier === 'source' ? 'stored' : event.tier,
          event.outcome === 'unavailable'
            ? reasonFor(event.path, declaredMissing)
            : undefined,
        ),
    });
    mutated = result.document.data;
  } catch (err: unknown) {
    throw programFailure(err, url, entry, bxl);
  }
  let links = await assertLinksExist(linked, ctx, url, fileURL);
  if (isEqual(mutated, resource)) {
    // The program ran and asked for nothing the card does not already hold, so
    // the file is left exactly as it is — staging the bytes it already holds
    // is what says so. The commit finds them unchanged, writes nothing, leaves
    // the modification time alone and queues nothing for indexing, while the
    // entry's result still reports the version the file holds. This is the
    // same answer a patch that changes nothing gives, and for the same reason.
    return {
      change: {
        writes: [{ path: sourcePath, content: stored.content }],
        appends: [],
        deletes: [],
        mints: [],
        links,
        id: url.href,
        primaryPath: sourcePath,
      },
      changed: false,
    };
  }
  // The id lives in the file's name, not in its contents.
  delete mutated.id;
  return {
    change: {
      writes: [
        {
          path: sourcePath,
          content: await serializeForStorage(
            mutated,
            { id: url.href, path: sourcePath },
            ctx,
          ),
        },
      ],
      appends: [],
      deletes: [],
      // Nothing here is a mint: a transform changes a card that is already
      // stored, and it stages no resource of its own.
      mints: [],
      links,
      id: url.href,
      primaryPath: sourcePath,
    },
    changed: true,
  };
}

// The program this entry runs.
//
// A named operation's program comes from its declaration and from nowhere
// else. An entry may carry one only where there is no declaration to read —
// the base behavior, invoked with the BXL written out — so a caller cannot
// hand a named operation a different program than the one its author wrote
// and have the realm run it under that author's name.
function programFor(entry: TransformEntry, url: URL): OperationProgram {
  let program = entry.definition ? entry.definition.program : entry.program;
  if (!program) {
    throw new OperationFailure({
      id: url.href,
      status: 400,
      code: 'invalid-params',
      title: 'No program',
      detail: entry.definition
        ? `operation "${entry.name ?? 'transform'}" is built on transform and ` +
          `carries no program, so there is nothing for it to do`
        : `a transform runs a program over the target's document, and this ` +
          `entry carries none`,
    });
  }
  return program;
}

// The card whose type the program is planned against. A card names its type in
// its own stored JSON, which is what lets an operation reach a definition
// without loading the card's module.
async function transformTargetDefinition(
  resource: CardResource,
  url: URL,
  ctx: StagingContext,
): Promise<Definition> {
  let definition = await ctx.lookupDefinition(resource.meta.adoptsFrom, url);
  if (!definition) {
    throw new OperationFailure({
      id: url.href,
      status: 500,
      code: 'internal-error',
      title: 'Unknown type',
      detail: `no definition for ${JSON.stringify(resource.meta.adoptsFrom)}`,
    });
  }
  return definition;
}

// Whether a program names a realm setting, and so whether staging it has to
// read one. The registry resolves a builtin by its exact name, so a program
// that calls this one carries the name in its source; a name that appears only
// inside a string costs a read the program does not use, which is the
// direction to be wrong in — the other way round would hand a program a slot
// the host had not filled.
function programNamesRealmConfig(source: string): boolean {
  return source.includes('realmConfig');
}

// The same question for a declaration's template, asked structurally because a
// template is data rather than text. A marker may be nested inside a `card(…)`
// wrapper or an object member, so every value is walked.
function templateNamesRealmConfig(template: unknown): boolean {
  if (Array.isArray(template)) {
    return template.some(templateNamesRealmConfig);
  }
  if (template === null || typeof template !== 'object') {
    return false;
  }
  let node = template as Record<string, unknown>;
  if (node.$ref === 'realmConfig') {
    return true;
  }
  return Object.values(node).some(templateNamesRealmConfig);
}

// The request-scoped values the program reads through `params()`, `actor()`,
// `instance()` and `realmConfig()`.
//
// The first two slots are supplied only where this invocation has something to
// put in them, because a program that names a slot the realm left out fails
// loudly rather than reading an empty one — which is the answer an author
// wants for `actor()` in a request that authenticated nobody.
//
// `instance(…)` reads the target's stored values, keyed the same way the
// named-create template reads them: the card's id, and its attributes. A link
// is an edge in the document's relationship map rather than a member of the
// stored value, so it is not something `instance(…)` names — the program
// reads one with `.field`, against the document it is editing.
//
// `realmConfig()` is supplied whenever the program names it, empty map
// included. A realm that declares no settings is a realm whose settings are
// known and empty, not a request that arrived without them, and the two read
// differently to whoever has to fix the program: "this realm has no such
// setting" points at the realm, "the host supplied no configuration" points at
// the caller. A program that never names it gets no slot and reads neither
// message, because it asks nothing.
function contextFor(
  params: Record<string, unknown> | undefined,
  resource: CardResource,
  url: URL,
  ctx: StagingContext,
  realmConfig: Record<string, JsonValue> | undefined,
): ProgramContext {
  return {
    ...(params ? { params } : {}),
    ...(ctx.actor ? { actor: ctx.actor } : {}),
    instance: {
      id: url.href,
      ...(resource.attributes ?? {}),
    },
    ...(realmConfig ? { realmConfig } : {}),
  };
}

// The payload, checked against the schema the operation declares and resolved
// into what a program reads.
//
// Checked before any BXL runs, because every way a payload can be wrong is the
// caller's to fix and finding out inside the planner means finding out after
// the work started. Three rules, each answering a different mistake: a
// declared param with no value would reach the program as a missing key, an
// undeclared one is a member the author never wrote and would be silently
// ignored, and a value that is not JSON cannot reach a program at all.
//
// What is deliberately not checked is a scalar against its declared field
// class. Deciding that a value is a valid `DateField` means running that
// field's own deserialization, which is card JavaScript, and an operation runs
// none — the value is held to being JSON here and to fitting the card by the
// realm's serializer when the changed document is written.
function resolvedParams(
  entry: TransformEntry,
  ctx: StagingContext,
  url: URL,
): Record<string, unknown> | undefined {
  let declared = entry.definition?.params;
  let sent = entry.params ?? {};
  if (!declared) {
    let [carried] = Object.keys(sent);
    if (carried !== undefined) {
      throw new OperationFailure({
        id: url.href,
        status: 400,
        code: 'invalid-params',
        title: 'Invalid params',
        detail:
          `this transform declares no params, so it takes none, and the ` +
          `payload carries "${carried}"`,
      });
    }
    return undefined;
  }
  for (let key of Object.keys(declared)) {
    if (own(sent, key) === undefined) {
      throw new OperationFailure({
        id: url.href,
        status: 400,
        code: 'invalid-params',
        title: 'Invalid params',
        detail: `operation "${entry.name ?? 'transform'}" requires a value for params("${key}")`,
      });
    }
  }
  let resolved: Record<string, unknown> = {};
  for (let key of Object.keys(sent)) {
    let definition = own(declared, key);
    if (!definition) {
      throw new OperationFailure({
        id: url.href,
        status: 400,
        code: 'invalid-params',
        title: 'Invalid params',
        detail:
          `operation "${entry.name ?? 'transform'}" declares no params("${key}"), ` +
          `so nothing in it reads what the payload carries there`,
      });
    }
    let value = own(sent, key);
    resolved[key] =
      definition.kind === 'link'
        ? // A link param carries a card identity: the URL of a saved card, or
          // the `lid` of one this batch creates, which resolves to the URL
          // that create will answer to. What the program receives is the URL
          // either way, so a program reads one kind of value there.
          identityOf(
            resolveLinkParam(value, ctx, `params("${key}")`),
            `params("${key}")`,
          )
        : jsonParam(value, key, url);
  }
  return resolved;
}

// A param value held to being JSON. A program's context is plain data — the
// planner walks it and refuses anything it cannot put in front of an
// expression — so a value that is not JSON is refused here, where the message
// can name the param that carries it.
function jsonParam(value: unknown, key: string, url: URL): unknown {
  let refuse = (why: string) => {
    throw new OperationFailure({
      id: url.href,
      status: 400,
      code: 'invalid-params',
      title: 'Invalid params',
      detail: `params("${key}") ${why}, and a program reads JSON`,
    });
  };
  let walk = (node: unknown, path: string): void => {
    if (node === null) {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((member, index) => walk(member, `${path}[${index}]`));
      return;
    }
    switch (typeof node) {
      case 'string':
      case 'boolean':
        return;
      case 'number':
        if (!Number.isFinite(node)) {
          refuse(`holds ${node} at ${path}`);
        }
        return;
      case 'object':
        for (let [member, child] of Object.entries(
          node as Record<string, unknown>,
        )) {
          walk(child, `${path}.${member}`);
        }
        return;
      default:
        refuse(`holds a ${typeof node} at ${path}`);
    }
  };
  walk(value, `params("${key}")`);
  return value;
}

// Why a read came back unavailable, matched against what this invocation said
// it could not supply.
//
// A read is refused at the path it names, and the declaration that refuses it
// may sit anywhere on that path: a whole subtree is incomplete when anything
// under it is missing, and a value inside a missing subtree is missing with
// it. So the path itself is looked for first, then a declaration nested under
// it, then one above — the order the reader of these declarations resolves
// them in, so the reason reported is the one that actually refused the read.
function reasonFor(
  path: string,
  declared: readonly UnavailableOverlay[],
): OperationMissingReason {
  let exact = declared.find((entry) => entry.path === path);
  let under = declared.find((entry) => entry.path.startsWith(`${path}.`));
  let above = declared.find((entry) => path.startsWith(`${entry.path}.`));
  return (exact ?? under ?? above)?.reason ?? 'key-absent';
}

// What the index can tell the program about values the stored document does
// not hold, and what it cannot.
//
// Two snapshots come back as overlay layers: `pristine_doc`, the card with its
// computed fields filled in, and `search_doc`, the fields of the cards it
// links to denormalized into its own row. Both carry the card's own stored
// fields alongside the ones only they can answer, which is fine and is why
// they are handed over whole — an overlay answers only where the stored
// document holds nothing.
//
// What the realm could *not* supply is listed as well, and that list is what
// makes an absent value fail loudly instead of reading as empty. It names only
// paths an overlay would have carried a value at:
//
//   - a computed field, whose value the card never stores;
//   - the fields of a `linksTo` target, which `search_doc` expands in place.
//
// A plural link is deliberately not among them. No overlay reaches inside a
// collection — a position is an identity only while nothing moves, and a
// program that inserts or reorders renumbers everything after it — so the
// values behind a `linksToMany` are not overlay territory, and claiming they
// are unavailable would speak for a place no overlay speaks for.
//
// Two more are absent because this walk cannot reach them, which is a bound
// rather than a decision. `Definition.fields` is the immediate field map —
// dotted paths are resolved by chasing `fieldOrCard` at lookup time, never
// pre-materialized — so a `linksTo` nested inside a contained value gets no
// marker, and `linkedMembers` stops at the link's own immediate fields, so
// `owner.friend.name` gets none either. A program reading one of those reads
// it as empty rather than being refused. Reaching them means walking the
// definition graph with a cycle guard, at a definition lookup per hop, on
// every transform; the depth that earns that is worth measuring against real
// declarations rather than guessing at here.
async function gatherOverlays(
  definition: Definition,
  url: URL,
  schema: unknown,
  project: (resource: CardResource, schema: unknown) => unknown,
  ctx: StagingContext,
): Promise<ProgramOverlays> {
  let row = await ctx.indexedCardValues(url);
  let unavailable: UnavailableOverlay[] = [];
  for (let [field, defId] of Object.entries(definition.fields)) {
    let fieldDef = definition.fieldDefs[defId];
    if (!fieldDef) {
      continue;
    }
    if (fieldDef.isComputed) {
      // A clean row means the indexer rendered this card, so every computed
      // field holds whatever it computed to — including nothing, which is a
      // value rather than an absence. Only the row's absence makes one
      // unavailable.
      if (!row) {
        unavailable.push({
          path: field,
          tier: 'computed',
          reason: 'not-indexed',
        });
      }
      continue;
    }
    if (fieldDef.type !== 'linksTo') {
      continue;
    }
    let reason: OperationMissingReason | undefined = !row
      ? 'not-indexed'
      : fieldDef.searchable == null
        ? // The link's target is in the index, but nothing denormalized its
          // fields into this row: `searchable` is what asks for that, and
          // without it those values never reach an operation. Lowering
          // refuses a declaration that reads one, so this is the backstop for
          // a program that got past it — a raw one, or a stored declaration
          // whose type has since dropped the annotation.
          'not-searchable'
        : undefined;
    let expanded = own(row?.searchDoc, field);
    for (let member of await linkedMembers(fieldDef, url, ctx)) {
      let missing: OperationMissingReason | undefined =
        reason ??
        (isPlainRecord(expanded) && own(expanded, member) !== undefined
          ? undefined
          : 'key-absent');
      if (missing) {
        unavailable.push({
          path: `${field}.${member}`,
          tier: 'linked',
          reason: missing,
        });
      }
    }
  }
  return {
    ...(row?.pristine ? { computeds: project(row.pristine, schema) } : {}),
    ...(row?.searchDoc ? { linked: row.searchDoc } : {}),
    unavailable,
  };
}

// The fields of a linked card that its link's row would carry, `id` excepted.
// A link's `id` is in the edge the card stores itself, so it is answered from
// the stored document whether or not anything was denormalized, and saying it
// is unavailable would take away a value the card has.
async function linkedMembers(
  fieldDef: FieldDefinition,
  url: URL,
  ctx: StagingContext,
): Promise<string[]> {
  let definition = await ctx.lookupDefinition(fieldDef.fieldOrCard, url);
  if (!definition) {
    return [];
  }
  return Object.keys(definition.fields).filter((field) => field !== 'id');
}

// Hold every card the program links to to being there to link to, and report
// the identities it settled on.
//
// A relationship the realm stores is an edge to a card, and an edge to a URL
// nothing answers is a card that will not load for anyone who follows it. The
// realm can say this about its own cards: one it has stored, or one another
// entry in this batch is minting. It cannot say it about a card in another
// realm — that realm's index is not this one's to read and no operation
// reaches the network — so a foreign link is recorded as sent, which is what
// every other write path does with one.
//
// Which of those a card id is has to be decided the way the realm decides it,
// not by asking whether the string parses as a URL. The planner hands over
// whatever the program wrote, and the serializer resolves a relative
// `links.self` against the file that holds it — so `./ghost` is not a URL here
// and *is* a URL inside this realm by the time the write lands. Resolving
// first is what puts both spellings in front of the same check; a genuinely
// foreign reference still falls out of `paths.local`, since an unregistered
// scoped reference comes back from `resolvedLink` unchanged.
async function assertLinksExist(
  linked: ReadonlySet<string>,
  ctx: StagingContext,
  url: URL,
  fileURL: URL,
): Promise<string[]> {
  let minted = new Set([...ctx.lids.values()].map((identity) => identity.id));
  let resolved = [...linked].map((id) => ctx.resolvedLink(id, fileURL));
  let dangling = (
    await Promise.all(
      resolved.map(async (id) => {
        if (minted.has(id)) {
          return undefined;
        }
        let localPath: LocalPath;
        try {
          localPath = ctx.paths.local(new URL(id));
        } catch {
          // Not a card this realm holds, so not one it can answer for.
          return undefined;
        }
        return (await ctx.fileExists(`${localPath}.json` as LocalPath))
          ? undefined
          : id;
      }),
    )
  ).find((id) => id !== undefined);
  if (dangling) {
    throw new OperationFailure({
      id: url.href,
      status: 400,
      code: 'invalid-params',
      title: 'Invalid link',
      detail:
        `the program links to ${dangling}, and realm ${ctx.realmURL} holds ` +
        `no card there`,
    });
  }
  return resolved;
}

// What the caller is told when a program will not run or will not hold.
//
// A failed `assert` is its own answer: the author wrote the message for
// exactly this, so it travels as the detail under the code that names a
// precondition, rather than as one more planning error. Everything else the
// planner refuses is a 400 carrying the phase and code it refused in, because
// a program that does not parse, names a field the type does not have, or
// reads a value the realm could not supply is a fault in the declaration or
// in the payload — the realm is working exactly as it should by saying so.
function programFailure(
  err: unknown,
  url: URL,
  entry: TransformEntry,
  bxl: BxlMutationModule,
): unknown {
  if (!bxl.isBxlMutationError(err)) {
    return err;
  }
  if (err.code === 'assertion-failed') {
    return new OperationFailure({
      id: url.href,
      status: 400,
      code: 'assertion-failed',
      title: 'Assertion failed',
      detail: err.message,
      meta: { operation: entry.name ?? 'transform', statement: err.statement },
    });
  }
  return new OperationFailure({
    id: url.href,
    status: 400,
    code: 'invalid-params',
    title: 'Cannot run program',
    detail: err.message,
    meta: {
      operation: entry.name ?? 'transform',
      phase: err.phase,
      bxlCode: err.code,
      statement: err.statement,
      ...(err.details ? { details: err.details } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Identities and links
// ---------------------------------------------------------------------------

// The identity a created card takes: `{TypeDirectory}/{id}.json`, under the
// realm root unless the entry names a directory. Path math only — no read and
// no serialization — which is what makes a create's URL knowable before
// anything is written.
//
// The id and the directory come from the caller and are spliced into a path,
// so both are held to naming what they appear to name. Two checks, because
// neither covers the other: each has to be a plain path segment, which is what
// refuses a separator; and the path that comes back has to be the path that
// went in, which is what refuses everything that only shows up once a URL is
// resolved — `..` and its percent-encoded spellings walking out of the type's
// directory, and a `?` or `#` cutting the stored path short so the card's id
// and its file stop naming each other.
//
// The type's directory is not one of the two. It comes from the type's own
// name rather than from the request, and a card adopting a type whose name
// carries a separator is stored under the nested path that name spells — the
// same place the card endpoints store it.
export function stagedIdentity(
  adoptsFrom: CodeRef | undefined,
  id: string,
  directory: string | undefined,
  paths: RealmPaths,
): StagedIdentity {
  let directorySegments = (directory ?? '').split('/').filter(Boolean);
  for (let segment of directorySegments) {
    assertPathSegment(segment, `directory segment "${segment}"`);
  }
  assertPathSegment(id, `id "${id}"`);
  let intended = `${[
    ...directorySegments,
    getCardDirectoryName(adoptsFrom, paths),
    id,
  ].join('/')}.json` as LocalPath;
  let url = paths.fileURL(intended);
  // `paths.local` throws for a URL that resolved outside the realm, which is
  // the loudest of the cases this is here to catch, so the comparison is made
  // where that throw becomes the same refusal a merely-wrong path gets.
  let resolved: string | undefined;
  try {
    resolved = paths.local(url);
  } catch {
    resolved = undefined;
  }
  if (resolved !== intended) {
    throw new OperationFailure({
      status: 400,
      code: 'invalid-params',
      title: 'Invalid id',
      detail:
        `a card created as "${id}" would be stored at ` +
        `${resolved ?? url.href} rather than ${intended}, so the id and the ` +
        `file would not name each other`,
    });
  }
  return { id: url.href.replace(/\.json$/, ''), path: intended };
}

// One name in a path, and nothing else. A separator would spread one card over
// a path the caller did not ask for, and the relative names address a
// directory rather than a card.
function assertPathSegment(value: string, what: string): void {
  if (
    value.length === 0 ||
    value === '.' ||
    value === '..' ||
    /[/\\]/.test(value)
  ) {
    throw new OperationFailure({
      status: 400,
      code: 'invalid-params',
      title: 'Invalid id',
      detail: `${what} is not a single path segment`,
    });
  }
}

// The identity a create entry's card takes, whether the entry sent a document
// or named an operation that mints the type. The `lid` index is consulted
// first so the file a create writes and the link another entry records are
// read from one place; an entry with no `lid` cannot be linked to, so its id
// is minted here.
export function createIdentity(
  entry: CreateEntry,
  resource: CardResource | undefined,
  paths: RealmPaths,
  lids: LidIndex,
): StagedIdentity {
  let lid = localIdOf(entry);
  if (lid !== undefined) {
    let staged = lids.get(lid);
    if (staged) {
      return staged;
    }
  }
  return stagedIdentity(
    resource?.meta?.adoptsFrom ?? entry.definition?.of,
    lid ?? uuidV4(),
    entry.directory,
    paths,
  );
}

// Whether a resource declares itself to belong to another realm. One batch
// commits to one realm, so a resource naming another is not this batch's to
// write.
export function namesForeignRealm(
  resource: CardResource,
  realmURL: string,
): boolean {
  let named = resource.meta?.realmURL;
  return Boolean(named) && ensureTrailingSlash(String(named)) !== realmURL;
}

function stagedLid(lid: string, ctx: StagingContext): StagedIdentity {
  let staged = ctx.lids.get(lid);
  if (!staged) {
    if (ctx.foreignLids.has(lid)) {
      // The caller did send this resource; the batch declined to write it, so
      // saying nothing creates it would describe a payload it did not send.
      // The remedy is a different one, too: the card is another realm's to
      // create, so either the link names it by URL or the resource stops
      // claiming a realm and this batch mints it.
      throw new OperationFailure({
        status: 400,
        code: 'invalid-params',
        title: 'Foreign local id',
        detail:
          `local id "${lid}" names a side-loaded resource stored in another ` +
          `realm, which a batch does not write; link to that card by its URL, ` +
          `or drop its \`meta.realmURL\` so this batch creates it here`,
      });
    }
    throw new OperationFailure({
      status: 400,
      code: 'invalid-params',
      title: 'Unknown local id',
      detail:
        `local id "${lid}" is referenced but no entry in the batch creates ` +
        `a card under it`,
    });
  }
  return staged;
}

// Rewrite every `{ lid }` reference a resource's relationships carry into a
// link to the card that `lid` names. A relationship's `data` is left as the
// client wrote it and only `links.self` is set, so the document still records
// which reference the client used.
function promoteStagedLinks(resource: CardResource, ctx: StagingContext): void {
  if (!resource.relationships) {
    return;
  }
  // Normalizing gives one flat map keyed by field name, with a plural field's
  // members under `field.0`, `field.1` — the keys whose `links.self` a
  // collection's edges are recorded under. The `Relationship` objects are the
  // resource's own, so setting a link here sets it on the document.
  let normalized = normalizeRelationships(resource.relationships);
  let setSelfLink = (relationship: Relationship, lid: string) => {
    if (ctx.foreignSideLoadLink === 'leave' && ctx.foreignLids.has(lid)) {
      // This caller asked for the link to be left as it was authored. There
      // is no card for the edge to point at — the side-load claims another
      // realm, so the batch does not write it — and serialization records a
      // link it cannot resolve as an explicit null. The card is stored saying
      // the edge is empty, rather than saying it points at a URL nothing is
      // stored under.
      return;
    }
    relationship.links = { self: stagedLid(lid, ctx).id };
  };
  for (let [fieldName, relationship] of Object.entries(normalized)) {
    let { data } = relationship;
    if (Array.isArray(data)) {
      for (let [index, item] of data.entries()) {
        if (!('lid' in item)) {
          continue;
        }
        // A collection's edges are stored one key per member — `field.0`,
        // `field.1` — and that is the only spelling whose links survive
        // serialization. A local id written inside a single `data` array has
        // no key of its own to carry a link, so it is refused: staging it
        // would store the collection with the edge missing and say nothing,
        // which is the one outcome worse than a refusal for the mechanism the
        // whole batch exists to provide. The card endpoints answer this
        // payload the same way, since they dispatch through here — where they
        // once recorded nothing and reported success.
        let indexed = normalized[`${fieldName}.${index}`];
        if (!indexed) {
          throw new OperationFailure({
            status: 400,
            code: 'invalid-params',
            title: 'Unlinkable local id',
            detail:
              `"${fieldName}" carries local id "${item.lid}" inside a \`data\` ` +
              `array, which has no per-member key to record the link on; ` +
              `write each member under its own "${fieldName}.N" key`,
          });
        }
        setSelfLink(indexed, item.lid);
      }
      continue;
    }
    if (data && 'lid' in data) {
      setSelfLink(relationship, data.lid);
    }
  }
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

// The bytes a card's file holds. The realm stamps its own URL on the resource
// before serializing, the same way it does for every card it stores, and the
// serializer resolves each field against the type's definition.
//
// The document's own module references resolve against the file it lands in,
// which for a created card is its type's directory rather than the realm root.
// So a caller naming a module relatively has to name it relative to that
// file — a realm-root-relative spelling addresses a module inside the type
// directory, where there is none. An absolute URL or a registered prefix
// resolves the same wherever the card is stored, which is what a caller that
// does not want to reason about the directory sends.
async function serializeForStorage(
  resource: CardResource,
  identity: StagedIdentity,
  ctx: StagingContext,
): Promise<string> {
  let fileURL = ctx.paths.fileURL(identity.path);
  let serialized: LooseSingleCardDocument;
  try {
    serialized = await ctx.serializeCard(
      { data: merge(resource, { meta: { realmURL: ctx.realmURL } }) },
      fileURL,
    );
  } catch (err: unknown) {
    let message = err instanceof Error ? err.message : String(err);
    // A field the type refuses is the caller's payload to fix; anything else
    // failed inside the realm.
    throw new OperationFailure({
      id: identity.id,
      status: message.startsWith('field validation error') ? 400 : 500,
      code: message.startsWith('field validation error')
        ? 'invalid-params'
        : 'internal-error',
      title: 'Cannot serialize card',
      detail: message,
    });
  }
  return JSON.stringify(serialized, null, 2);
}

// The card resource a stored file holds, or nothing when the file is not a
// card document. Both callers ask the same question of the same bytes and
// differ only in what they make of a miss, so they read it through here
// rather than each parsing for itself.
function cardResourceIn(content: string): CardResource | undefined {
  let resource: unknown;
  try {
    resource = (JSON.parse(content) as { data?: unknown }).data;
  } catch (err: unknown) {
    resource = undefined;
  }
  return isCardResource(resource) ? resource : undefined;
}

// The card resource a stored file holds. A file that is not a card document is
// reported as the realm's own fault rather than the caller's: the caller asked
// to patch a card, and what is on disk is not one.
function storedResource(content: string, url: URL): CardResource {
  let resource = cardResourceIn(content);
  if (!resource) {
    throw new OperationFailure({
      id: url.href,
      status: 500,
      code: 'internal-error',
      title: 'Invalid stored card',
      detail: `the stored file for ${url.href} is not a valid card document`,
    });
  }
  let stored = cloneDeep(resource);
  // Stamped from the file's own modification time when the card is served, so
  // it is not part of what the merge compares or writes.
  delete stored.meta.lastModified;
  return stored;
}

// ---------------------------------------------------------------------------
// Named `create` templates
// ---------------------------------------------------------------------------

// A named create stages its card from the operation's own declaration: `of`
// names the type, and `fill` is a JSON template whose typed-reference markers
// this invocation supplies the values for. Resolving it is plain substitution
// rather than BXL — each marker becomes its value — and from there it is the
// same path a create from a document takes.
async function resourceFromTemplate(
  entry: CreateEntry,
  definition: OperationDefinition,
  ctx: StagingContext,
): Promise<CardResource> {
  let of = definition.of!;
  // The payload has to satisfy the declaration's own schema before anything is
  // substituted from it. A missing value would otherwise resolve to
  // `undefined` and the field would simply be left off the card, so a caller
  // that forgot a required param would get a card quietly missing it rather
  // than being told. This is the check dispatch applies before an executor
  // runs, applied here for the callers that stage a batch directly.
  for (let key of Object.keys(definition.params ?? {})) {
    if (own(entry.params, key) === undefined) {
      throw new OperationFailure({
        status: 400,
        code: 'invalid-params',
        title: 'Invalid params',
        detail: `this create requires a value for params("${key}")`,
      });
    }
  }
  let anchor = entry.href ? anchorResource(entry, ctx) : undefined;
  let linkFields = await linkFieldsOf(of, entry, ctx);
  // Same as a transform: only a declaration that names a setting waits for one.
  let realmConfig = templateNamesRealmConfig(definition.fill)
    ? await ctx.realmConfig()
    : {};
  let resource: CardResource = { type: 'card', meta: { adoptsFrom: of } };
  for (let [field, template] of Object.entries(definition.fill ?? {})) {
    let resolved = resolveTemplate(template, {
      entry,
      definition,
      ctx,
      anchor,
      field,
      realmConfig,
    });
    if (resolved.value === undefined) {
      continue;
    }
    if (resolved.isLink || linkFields.has(field)) {
      // The field's own type can make a link out of a value the template did
      // not mark as one, so this is where a user id headed for a
      // relationship is caught.
      if (resolved.isActor) {
        throw new OperationFailure({
          status: 400,
          code: 'invalid-params',
          title: 'Invalid reference',
          detail: actorIsNotACard(field),
        });
      }
      setLink(resource, field, resolved.value, field);
      continue;
    }
    resource.attributes = { ...resource.attributes, [field]: resolved.value };
  }
  return resource;
}

// The card a named create is anchored on, as `instance(…)` reads it: the
// target's stored document, never a live card instance.
function anchorResource(
  entry: CreateEntry,
  ctx: StagingContext,
): { id: string; resource: CardResource } {
  let url = targetURL(entry.href!);
  let sourcePath = `${localPathIn(url, ctx)}.json` as LocalPath;
  let stored = ctx.stored.get(sourcePath);
  if (!stored) {
    throw new OperationFailure({
      id: url.href,
      status: 404,
      code: 'target-not-found',
      title: 'Not found',
      detail: `${url.href} does not exist in realm ${ctx.realmURL}`,
    });
  }
  return { id: url.href, resource: storedResource(stored.content, url) };
}

// The fields of the created type that hold links rather than values. A link is
// an edge in the document's `relationships`, never a member of the stored
// value, so which fields are links decides where a resolved value lands. The
// type's own definition is the authority; a `card(…)` marker and a `linkTo`
// param say the same thing about a single value, and are honored even when the
// type's entry cannot be read.
async function linkFieldsOf(
  of: CodeRef,
  entry: CreateEntry,
  ctx: StagingContext,
): Promise<Set<string>> {
  let relativeTo = new URL(ctx.realmURL);
  let definition = await ctx.lookupDefinition(of, relativeTo);
  if (!definition) {
    return new Set();
  }
  let links = new Set<string>();
  for (let field of Object.keys(entry.definition?.fill ?? {})) {
    let fieldDef = getImmediateFieldDef(definition, field);
    if (fieldDef?.type === 'linksTo' || fieldDef?.type === 'linksToMany') {
      links.add(field);
    }
  }
  return links;
}

// Record a link, or a collection of them, on the resource. A collection's
// edges are keyed `field.0`, `field.1` — one edge per key, which is how a
// relationship collection is stored and how it is changed one edge at a time.
function setLink(
  resource: CardResource,
  field: string,
  value: unknown,
  path: string,
): void {
  resource.relationships ??= {};
  if (Array.isArray(value)) {
    value.forEach((member, index) => {
      resource.relationships![`${field}.${index}`] = {
        links: { self: identityOf(member, `${path}[${index}]`) },
      };
    });
    return;
  }
  resource.relationships[field] = {
    links: { self: identityOf(value, path) },
  };
}

// A link holds the identity of a card. Anything else in a link position would
// fail on every invocation, so it is refused with the position that names it.
function identityOf(value: unknown, path: string): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  throw new OperationFailure({
    status: 400,
    code: 'invalid-params',
    title: 'Invalid link',
    detail:
      `\`${path}\` holds a link, so it needs the identity of a card — a URL, ` +
      `or the \`lid\` of one this batch creates`,
  });
}

interface TemplateScope {
  entry: CreateEntry;
  definition: OperationDefinition;
  ctx: StagingContext;
  anchor: { id: string; resource: CardResource } | undefined;
  field: string;
  // The realm's settings, resolved before the template is walked. Resolving
  // one is asynchronous and walking a template is not, so it arrives here
  // rather than being read where it is used.
  realmConfig: Record<string, JsonValue>;
}

interface ResolvedTemplate {
  value: unknown;
  // Whether the template itself declared this a link — a `card(…)` marker, or
  // a param the schema declares as one.
  isLink: boolean;
  // Whether this value came from the caller. Carried separately from the
  // value because a user id is an ordinary string once resolved, and the
  // field it lands in is what decides whether that is a problem.
  isActor: boolean;
}

function resolveTemplate(
  template: OperationTemplate,
  scope: TemplateScope,
  path = scope.field,
): ResolvedTemplate {
  if (Array.isArray(template)) {
    let members = template.map((member, index) =>
      resolveTemplate(member, scope, `${path}[${index}]`),
    );
    return {
      value: members.map((member) => member.value),
      isLink: members.some((member) => member.isLink),
      isActor: members.some((member) => member.isActor),
    };
  }
  if (!isMarker(template)) {
    if (template !== null && typeof template === 'object') {
      let value: Record<string, unknown> = {};
      let isLink = false;
      let isActor = false;
      for (let [key, member] of Object.entries(
        template as Record<string, OperationTemplate>,
      )) {
        let resolved = resolveTemplate(member, scope, `${path}.${key}`);
        value[key] = resolved.value;
        isLink ||= resolved.isLink;
        isActor ||= resolved.isActor;
      }
      return { value, isLink, isActor };
    }
    return { value: template, isLink: false, isActor: false };
  }
  return resolveMarker(template, scope, path);
}

function resolveMarker(
  marker: Record<string, unknown>,
  scope: TemplateScope,
  path: string,
): ResolvedTemplate {
  let { entry, definition, ctx, anchor } = scope;
  switch (marker.$ref) {
    case 'params': {
      let key = String(marker.key);
      let declared = own(definition.params, key);
      let value = own(entry.params, key);
      return {
        // A `link` param carries a card identity: the URL of a saved card, or
        // the `lid` of one this batch creates, which resolves to the URL the
        // create will answer to.
        value:
          declared?.kind === 'link'
            ? resolveLinkParam(value, ctx, path)
            : value,
        isLink: declared?.kind === 'link',
        isActor: false,
      };
    }
    case 'actor':
      if (!ctx.actor) {
        throw new OperationFailure({
          status: 400,
          code: 'invalid-params',
          title: 'No actor in scope',
          detail:
            `\`${path}\` reads the invoking actor, and this invocation was ` +
            `made without one`,
        });
      }
      // The realm authenticates the caller as a user id and knows nothing
      // else about them, so the marker carries no key and a stored one names
      // a member that does not exist.
      if (marker.key !== undefined) {
        throw new OperationFailure({
          status: 400,
          code: 'invalid-params',
          title: 'Invalid reference',
          detail:
            `\`${path}\` reads actor("${String(marker.key)}"), and the ` +
            `caller is a user id with no members to read`,
        });
      }
      // The template says nothing about links, so the field this lands in is
      // what decides whether a user id belongs there; `isActor` carries the
      // answer to where that is known.
      return { value: ctx.actor, isLink: false, isActor: true };
    case 'instance': {
      if (!anchor) {
        throw new OperationFailure({
          status: 400,
          code: 'invalid-params',
          title: 'No instance in scope',
          detail:
            `\`${path}\` reads the target's stored document, and this ` +
            `invocation names no target`,
        });
      }
      if (marker.key === undefined || marker.key === 'id') {
        return { value: anchor.id, isLink: false, isActor: false };
      }
      return {
        value: own(anchor.resource.attributes, String(marker.key)),
        isLink: false,
        isActor: false,
      };
    }
    case 'card': {
      // The marker says this value is a link whatever it resolves to, so a
      // nested reference is resolved and the result read as an identity —
      // which is the one thing the caller cannot supply. A user id names no
      // card, so the edge would point at a URL nothing is stored at.
      if (isMarker(marker.value) && marker.value.$ref === 'actor') {
        throw new OperationFailure({
          status: 400,
          code: 'invalid-params',
          title: 'Invalid reference',
          detail: actorIsNotACard(path),
        });
      }
      let inner = isMarker(marker.value)
        ? resolveMarker(marker.value, scope, path).value
        : marker.value;
      return {
        value: resolveLinkParam(inner, ctx, path),
        isLink: true,
        isActor: false,
      };
    }
    case 'realmConfig': {
      // A setting the realm holds rather than the caller sends, so an absent
      // one is the realm's gap and not the payload's — and it is refused here
      // rather than defaulted, for the reason every reference is: a template
      // that quietly wrote nothing where a setting belongs would store the
      // absence as the value.
      let settings = scope.realmConfig;
      if (marker.key === undefined) {
        return { value: { ...settings }, isLink: false, isActor: false };
      }
      let key = String(marker.key);
      if (!Object.prototype.hasOwnProperty.call(settings, key)) {
        throw new OperationFailure({
          status: 400,
          code: 'invalid-params',
          title: 'Unknown realm setting',
          detail:
            `\`${path}\` reads realmConfig("${key}"), which realm ` +
            `${ctx.realmURL} does not configure`,
        });
      }
      return { value: settings[key], isLink: false, isActor: false };
    }
    default:
      throw new OperationFailure({
        status: 400,
        code: 'invalid-params',
        title: 'Invalid reference',
        detail: `\`${path}\` carries a reference the realm does not resolve: ${JSON.stringify(
          marker.$ref,
        )}`,
      });
  }
}

// Why the caller cannot stand where a card identity belongs. The realm
// authenticates a caller as a user id and no card represents a user, so an
// edge built from one points at a URL nothing is stored at.
function actorIsNotACard(path: string): string {
  return `\`${path}\` needs a card identity, and actor() is the caller's user id rather than a card — take the person as a param declared with linkTo(…) and write that instead`;
}

// A link's value as the caller supplied it: the URL of a saved card, or the
// `lid` of one this batch creates.
function resolveLinkParam(
  value: unknown,
  ctx: StagingContext,
  path: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((member, index) =>
      resolveLinkParam(member, ctx, `${path}[${index}]`),
    );
  }
  if (isPlainRecord(value) && typeof value.lid === 'string') {
    return stagedLid(value.lid, ctx).id;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function targetURL(href: string): URL {
  try {
    return new URL(href);
  } catch {
    throw new OperationFailure({
      id: href,
      status: 400,
      code: 'invalid-params',
      title: 'Invalid target',
      detail: `target "${href}" is not a URL`,
    });
  }
}

function localPathIn(url: URL, ctx: StagingContext): LocalPath {
  try {
    return ctx.paths.local(url);
  } catch {
    throw new OperationFailure({
      id: url.href,
      status: 404,
      code: 'target-not-found',
      title: 'Not found',
      detail: `realm ${ctx.realmURL} does not contain ${url.href}`,
    });
  }
}

// A stored file's content as JSON, or undefined when it is not JSON at all.
// What the predicates above are asked about is the document a file holds, and
// a file that holds no document answers none of them.
function parsed(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

// Read a record by a key that arrived over the wire. A plain object answers
// `toString` and `constructor` with something that is not a param, and reading
// one of those as a declaration gets as far as staging a value nobody sent.
function own<T>(
  record: Record<string, T> | undefined,
  key: string,
): T | undefined {
  if (!record || !Object.prototype.hasOwnProperty.call(record, key)) {
    return undefined;
  }
  return record[key];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMarker(value: unknown): value is Record<string, unknown> {
  return (
    isPlainRecord(value) &&
    Object.prototype.hasOwnProperty.call(value, '$ref') &&
    typeof value.$ref === 'string'
  );
}

// ---------------------------------------------------------------------------
// `appendContainsMany`
// ---------------------------------------------------------------------------

// Add items to a card's `containsMany` field by editing the stored JSON as
// text, without ever holding the card's document.
//
// One item is stored in up to three parallel places, and its parts go to
// different ones: its values into the array under `data.attributes.<field>`,
// every `linksTo` / `linksToMany` its item type declares into
// `data.relationships` under the flattened key `<field>.<N>.<link>`, and its
// concrete type — when that is not the declared one — into the sidecar under
// `data.meta.fields`. Which member is which comes from the type's
// definition-cache entry, so the split costs a cache read and runs no card
// JavaScript.
//
// The field this writes is why the behavior exists. A ledger, an audit trail,
// an event log holds as many items as the card has ever recorded, and
// `transform`'s `append` reaches those items by loading the document. Here the
// stored file is scanned as a byte stream for the offsets the insertions go
// at, and what is staged is a description of the result rather than the result
// — so adding one item costs one item, whatever the array already holds.
export async function stageAppendContainsMany(
  entry: AppendContainsManyEntry,
  ctx: StagingContext,
): Promise<StagedChange> {
  let url = targetURL(entry.href);
  let sourcePath = `${localPathIn(url, ctx)}.json` as LocalPath;
  let target: AppendTarget = { url, file: ctx.paths.fileURL(sourcePath) };
  let requested = requestedItems(entry, url);
  let bytes = await ctx.openSourceBytes(sourcePath);
  if (!bytes) {
    throw new OperationFailure({
      id: url.href,
      status: 404,
      code: 'target-not-found',
      title: 'Not found',
      detail: `${url.href} does not exist in realm ${ctx.realmURL}`,
    });
  }
  let base =
    ctx.splices.get(sourcePath) ??
    (ctx.stored.has(sourcePath)
      ? wholeText(sourcePath, ctx.stored.get(sourcePath)!.content)
      : wholeFile(sourcePath, bytes.size));
  // One pass over the bytes locates every offset every named field needs, so
  // appending to two fields costs the same read as appending to one.
  let layout = await readLayout(base, [...requested.keys()], bytes, url);
  let definition = await appendTargetDefinition(layout, url, ctx);
  // Read once from the document rather than assumed, so an insertion into a
  // container that carries no whitespace of its own — an empty array, a
  // container the file does not have — is written the way the rest of the file
  // is written.
  let style = indentStyleOf(layout);

  // Every member an insertion will add, by the container it goes into.
  // Grouped so a container gaining members for two reasons — two fields whose
  // items both link, say — takes one insertion holding both rather than two
  // that each assume they are the only one.
  let pending = new Map<StoredContainer, string[]>();
  let addTo = (container: StoredContainer, members: string[]) => {
    let existing = pending.get(container);
    if (existing) {
      existing.push(...members);
    } else {
      pending.set(container, [...members]);
    }
  };
  // Members bound for a container the file does not carry, which is created
  // once holding all of them.
  let newArrays = new Map<string, unknown[]>();
  let newRelationships: [string, unknown][] = [];
  let newSidecars = new Map<string, unknown[]>();

  for (let [field, items] of requested) {
    let itemDef = await appendableField(definition, field, url, ctx);
    let array = layout.arrays.get(field);
    if (!array && layout.attributeKeys.has(field)) {
      throw new OperationFailure({
        id: url.href,
        status: 500,
        code: 'internal-error',
        title: 'Invalid stored card',
        detail:
          `"${field}" is a containsMany field, and the stored file for ` +
          `${url.href} holds something other than an array under it`,
      });
    }
    let at = array?.count ?? 0;
    let values: unknown[] = [];
    let types: (CodeRef | undefined)[] = [];
    for (let [offset, item] of items.entries()) {
      let split = await splitItem(
        item,
        itemDef,
        `${field}.${at + offset}`,
        target,
        ctx,
      );
      values.push(split.value);
      types.push(split.adoptsFrom);
      newRelationships.push(...split.relationships);
    }
    if (array) {
      addTo(
        array,
        values.map((value) => renderValue(value, indentsFor(array, style))),
      );
    } else {
      newArrays.set(field, values);
    }
    if (types.every((type) => type === undefined)) {
      continue;
    }
    // A composite `containsMany` records its items' types positionally — one
    // sidecar entry per item — so an entry has to reach the item's index,
    // which means standing in for every item ahead of it that had no type of
    // its own.
    let sidecar = layout.sidecars.get(field);
    if (!sidecar && layout.metaFieldKeys.has(field)) {
      throw new OperationFailure({
        id: url.href,
        status: 500,
        code: 'internal-error',
        title: 'Invalid stored card',
        detail:
          `the stored file for ${url.href} records the types of "${field}" ` +
          `as something other than an array`,
      });
    }
    let filled = sidecar?.count ?? 0;
    if (filled > at) {
      // The sidecar is positional, so one longer than the array it describes
      // names items that are not there — and an entry appended after it would
      // land at an index no item occupies.
      throw new OperationFailure({
        id: url.href,
        status: 500,
        code: 'internal-error',
        title: 'Invalid stored card',
        detail:
          `the stored file for ${url.href} records ${filled} types for ` +
          `"${field}", which holds ${at} items`,
      });
    }
    let entries: unknown[] = [];
    for (let index = filled; index < at; index++) {
      entries.push({});
    }
    for (let type of types) {
      entries.push(type ? { adoptsFrom: type } : {});
    }
    if (sidecar) {
      addTo(
        sidecar,
        entries.map((entry) => renderValue(entry, indentsFor(sidecar, style))),
      );
    } else {
      newSidecars.set(field, entries);
    }
  }

  let data = layout.data!;
  if (newArrays.size > 0) {
    let into = layout.attributes;
    if (into) {
      addTo(
        into,
        [...newArrays].map(([field, values]) =>
          renderMember(field, values, indentsFor(into, style)),
        ),
      );
    } else {
      addTo(data, [
        renderMember(
          'attributes',
          Object.fromEntries(newArrays),
          indentsFor(data, style),
        ),
      ]);
    }
  }
  if (newRelationships.length > 0) {
    let into = layout.relationships;
    if (into) {
      addTo(
        into,
        newRelationships.map(([key, value]) =>
          renderMember(key, value, indentsFor(into, style)),
        ),
      );
    } else {
      addTo(data, [
        renderMember(
          'relationships',
          Object.fromEntries(newRelationships),
          indentsFor(data, style),
        ),
      ]);
    }
  }
  if (newSidecars.size > 0) {
    // `data.meta` is always there: the type read above found `adoptsFrom`
    // inside it, and an append that could not read the type never reaches
    // here.
    let into = layout.metaFields ?? layout.meta!;
    addTo(
      into,
      layout.metaFields
        ? [...newSidecars].map(([field, entries]) =>
            renderMember(field, entries, indentsFor(into, style)),
          )
        : [
            renderMember(
              'fields',
              Object.fromEntries(newSidecars),
              indentsFor(into, style),
            ),
          ],
    );
  }

  let edits: SpliceEdit[] = [];
  for (let [container, members] of pending) {
    let edit = appendMembers(container, members, style);
    if (edit) {
      edits.push(edit);
    }
  }
  return {
    writes: [{ path: sourcePath, content: splice(base, edits) }],
    appends: [],
    deletes: [],
    // Nothing here is a mint: an append changes a card that is already stored.
    mints: [],
    id: url.href,
    primaryPath: sourcePath,
  };
}

// The fields an append names and the items bound for each, from either
// spelling: one field with its items, or several fields each with their own.
// The members are the ones the envelope's `data` carries, so the endpoint
// hands them through rather than translating them.
function requestedItems(
  entry: AppendContainsManyEntry,
  url: URL,
): Map<string, unknown[]> {
  let refuse = (detail: string): never => {
    throw new OperationFailure({
      id: url.href,
      status: 400,
      code: 'invalid-params',
      title: 'Invalid append',
      detail,
    });
  };
  let requested = new Map<string, unknown[]>();
  if (entry.fields !== undefined) {
    if (entry.field !== undefined || entry.items !== undefined) {
      refuse(
        `an append names one field with its items, or several under ` +
          `\`fields\`, and this one does both`,
      );
    }
    if (!isPlainRecord(entry.fields)) {
      refuse(`\`fields\` maps each field name to the items to append to it`);
    }
    for (let [field, items] of Object.entries(entry.fields)) {
      if (!Array.isArray(items)) {
        refuse(`the items for "${field}" are not a list`);
      }
      requested.set(field, items);
    }
  } else {
    if (typeof entry.field !== 'string' || entry.field.length === 0) {
      refuse(`an append names the field it appends to, and this one does not`);
    }
    if (!Array.isArray(entry.items)) {
      refuse(`the items to append are not a list`);
    }
    requested.set(entry.field as string, entry.items as unknown[]);
  }
  if ([...requested.values()].every((items) => items.length === 0)) {
    // An append of nothing would still rewrite the file, and a file without a
    // change is never rewritten.
    refuse(`an append names the items to append, and this one names none`);
  }
  return requested;
}

// Where the insertions go, read out of the stored bytes in one pass.
async function readLayout(
  base: SplicedSource,
  fields: string[],
  bytes: SourceBytes,
  url: URL,
): Promise<CardSourceLayout> {
  let layout: CardSourceLayout;
  try {
    layout = await scanCardSource(
      streamSpliced(base, (start, end) => bytes.read(start, end)),
      fields,
    );
  } catch (err: unknown) {
    throw new OperationFailure({
      id: url.href,
      status: 500,
      code: 'internal-error',
      title: 'Invalid stored card',
      detail:
        `the stored file for ${url.href} is not a JSON document an append ` +
        `can edit: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  if (!layout.data) {
    throw new OperationFailure({
      id: url.href,
      status: 500,
      code: 'internal-error',
      title: 'Invalid stored card',
      detail: `the stored file for ${url.href} carries no \`data\` member`,
    });
  }
  // Each of these holds named members, and an insertion writes `"key": value`
  // into it. One holding an array instead takes that text just as readily and
  // leaves behind a file that no longer parses — so the kind is checked here,
  // where every container an insertion can reach passes through, rather than
  // at each of the places one is written to.
  for (let [name, container] of [
    ['data', layout.data],
    ['data.attributes', layout.attributes],
    ['data.relationships', layout.relationships],
    ['data.meta', layout.meta],
    ['data.meta.fields', layout.metaFields],
  ] as const) {
    if (container && container.kind !== 'object') {
      throw new OperationFailure({
        id: url.href,
        status: 500,
        code: 'internal-error',
        title: 'Invalid stored card',
        detail:
          `the stored file for ${url.href} holds an array under \`${name}\`, ` +
          `which names members rather than positions`,
      });
    }
  }
  return layout;
}

// The target's type, named by the card's own bytes rather than by the index:
// the index is downstream of the file and can lag it, and what an append needs
// the type for — which of an item's members are links — has to describe the
// bytes it is editing.
async function appendTargetDefinition(
  layout: CardSourceLayout,
  url: URL,
  ctx: StagingContext,
): Promise<Definition> {
  if (!layout.adoptsFrom) {
    throw new OperationFailure({
      id: url.href,
      status: 500,
      code: 'internal-error',
      title: 'Invalid stored card',
      detail:
        `the stored file for ${url.href} does not name its type as a module ` +
        `and an export under \`data.meta.adoptsFrom\`, so an item cannot be ` +
        `split into its stored parts`,
    });
  }
  let definition = await ctx.lookupDefinition(layout.adoptsFrom, url);
  if (!definition) {
    throw new OperationFailure({
      id: url.href,
      status: 500,
      code: 'internal-error',
      title: 'Unknown type',
      detail: `no definition for ${JSON.stringify(layout.adoptsFrom)}`,
    });
  }
  return definition;
}

// The definition of the items in the field an append names, after holding the
// field to being one an append can write: a collection of values this card
// stores itself. Undefined for a collection of primitives, whose items have no
// fields of their own and so no definition to split against.
async function appendableField(
  definition: Definition,
  field: string,
  url: URL,
  ctx: StagingContext,
): Promise<Definition | undefined> {
  let fieldDef = getImmediateFieldDef(definition, field);
  if (!fieldDef) {
    throw new OperationFailure({
      id: url.href,
      status: 400,
      code: 'invalid-params',
      title: 'Unknown field',
      detail: `${url.href} has no field named "${field}"`,
    });
  }
  if (fieldDef.type !== 'containsMany') {
    throw new OperationFailure({
      id: url.href,
      status: 400,
      code: 'invalid-params',
      title: 'Not a containsMany',
      detail:
        `"${field}" is a ${fieldDef.type} field; an append adds items to a ` +
        `containsMany`,
    });
  }
  if (fieldDef.isComputed) {
    throw new OperationFailure({
      id: url.href,
      status: 400,
      code: 'invalid-params',
      title: 'Computed field',
      detail:
        `"${field}" is computed, so its value comes from its \`computeVia\` ` +
        `rather than from what is stored`,
    });
  }
  return fieldDef.isPrimitive
    ? undefined
    : await itemDefinitionOf(fieldDef, field, url, ctx);
}

async function itemDefinitionOf(
  fieldDef: FieldDefinition,
  field: string,
  url: URL,
  ctx: StagingContext,
): Promise<Definition> {
  let definition = await ctx.lookupDefinition(fieldDef.fieldOrCard, url);
  if (!definition) {
    throw new OperationFailure({
      id: url.href,
      status: 500,
      code: 'internal-error',
      title: 'Unknown type',
      detail:
        `no definition for the items of "${field}" ` +
        `(${JSON.stringify(fieldDef.fieldOrCard)})`,
    });
  }
  return definition;
}

// The card an append is writing to, in the two forms its parts are addressed
// by: the URL it answers to, which names it in a refusal, and the file its
// bytes live in, which a stored link is recorded relative to.
interface AppendTarget {
  url: URL;
  file: URL;
}

interface SplitItem {
  // What the array holds: the item's own values, with every link taken out.
  value: unknown;
  // The item's concrete type, when it declared one.
  adoptsFrom?: CodeRef;
  // The flattened relationship keys the item's links are recorded under, and
  // what each records. A null link is a position the author emptied, which the
  // file records rather than leaves out.
  relationships: [string, { links: { self: string | null } }][];
}

// Split one appended item into the parts the file stores separately.
//
// An item of a primitive collection is its own value and nothing else. One of
// a composite collection is a record of that item type's fields, so each
// member is placed by what the item type says it is: a link leaves the value
// and becomes a relationship key, a nested composite is split the same way one
// level down, and everything else stays where it was written. A member the
// item type does not declare is refused rather than stored, since nothing
// would ever read it back.
//
// An item that names its own type is split against *that* type, not against
// the declared one — a subtype's own fields are the point of declaring it, so
// splitting against the declared type would refuse every one of them.
async function splitItem(
  item: unknown,
  itemDef: Definition | undefined,
  path: string,
  target: AppendTarget,
  ctx: StagingContext,
): Promise<SplitItem> {
  if (!itemDef) {
    return { value: item, relationships: [] };
  }
  if (!isPlainRecord(item)) {
    throw new OperationFailure({
      status: 400,
      code: 'invalid-params',
      title: 'Invalid item',
      detail:
        `\`${path}\` holds a composite value, so the item is a record of its ` +
        `fields`,
    });
  }
  let adoptsFrom: CodeRef | undefined;
  let rest: Record<string, unknown> = item;
  // A card declares its type under `meta.adoptsFrom`, and an item whose
  // concrete type differs from the declared one says so the same way. An item
  // type that declares a field of its own named `meta` would make the two
  // spellings indistinguishable, so that collision is named rather than
  // guessed at.
  if (Object.prototype.hasOwnProperty.call(item, 'meta')) {
    if (getImmediateFieldDef(itemDef, 'meta')) {
      throw new OperationFailure({
        status: 400,
        code: 'invalid-params',
        title: 'Ambiguous item',
        detail:
          `\`${path}\` declares a field named "meta", which is also where an ` +
          `item names its own type, so the member cannot be placed`,
      });
    }
    adoptsFrom = itemTypeOf(item.meta, path);
    rest = { ...item };
    delete rest.meta;
  }
  let against = adoptsFrom
    ? await declaredItemType(adoptsFrom, path, target.url, ctx)
    : itemDef;
  let split = await splitValue(rest, against, path, target, ctx);
  return { ...split, ...(adoptsFrom ? { adoptsFrom } : {}) };
}

// The type an item named for itself. Whether it is one the declared item type
// admits is not something the cached definitions can answer — they record a
// type's own fields, not what it adopts — so a type the realm can read is
// taken at its word here, and a value the field ultimately refuses surfaces
// where every other one does, when the card indexes.
async function declaredItemType(
  adoptsFrom: CodeRef,
  path: string,
  url: URL,
  ctx: StagingContext,
): Promise<Definition> {
  let definition = await ctx.lookupDefinition(adoptsFrom, url);
  if (!definition) {
    throw new OperationFailure({
      id: url.href,
      status: 400,
      code: 'invalid-params',
      title: 'Unknown item type',
      detail:
        `\`${path}.meta\` names ${JSON.stringify(adoptsFrom)}, which the ` +
        `realm has no definition for`,
    });
  }
  return definition;
}

function itemTypeOf(meta: unknown, path: string): CodeRef {
  let adoptsFrom = isPlainRecord(meta) ? meta.adoptsFrom : undefined;
  if (
    !isPlainRecord(adoptsFrom) ||
    typeof adoptsFrom.module !== 'string' ||
    typeof adoptsFrom.name !== 'string'
  ) {
    throw new OperationFailure({
      status: 400,
      code: 'invalid-params',
      title: 'Invalid item type',
      detail:
        `\`${path}.meta\` names the item's own type, as ` +
        `\`{ adoptsFrom: { module, name } }\``,
    });
  }
  // A sidecar entry is an item's whole `meta`, and a nested composite of its
  // own contributes a `fields` member to it. An append writes only the type,
  // so anything else here would be accepted and then dropped — which is the
  // one outcome worse than refusing it.
  let extra = Object.keys(meta as Record<string, unknown>).filter(
    (key) => key !== 'adoptsFrom',
  );
  if (extra.length > 0) {
    throw new OperationFailure({
      status: 400,
      code: 'invalid-params',
      title: 'Invalid item type',
      detail:
        `\`${path}.meta\` carries ${quoted(extra)}, and an append records ` +
        `only an item's own type there; a value whose nested fields need ` +
        `types of their own is written with a \`transform\``,
    });
  }
  return { module: rri(adoptsFrom.module), name: adoptsFrom.name };
}

function quoted(names: string[]): string {
  return names.map((name) => `"${name}"`).join(', ');
}

// A link position an author left empty, as the file stores it.
function emptyLink(): { links: { self: null } } {
  return { links: { self: null } };
}

// One relationship as the file stores it. A link is recorded the way the
// realm's own serializer records one — relative to the file that holds it when
// it points inside this realm — so two entries in one batch that link to the
// same card write the same thing, whether one of them was an append and the
// other a create.
function storedRelationship(
  value: unknown,
  target: AppendTarget,
  path: string,
  ctx: StagingContext,
): { links: { self: string } } {
  let identity = identityOf(resolveLinkParam(value, ctx, path), path);
  // Against the file rather than the card: a relative reference is resolved
  // from the document that carries it, which is what the serializer passes and
  // what a reader of the stored bytes resolves against.
  return { links: { self: ctx.storedLink(identity, target.file) } };
}

async function splitValue(
  value: Record<string, unknown>,
  definition: Definition,
  path: string,
  target: AppendTarget,
  ctx: StagingContext,
): Promise<{ value: unknown; relationships: SplitItem['relationships'] }> {
  let stored: Record<string, unknown> = {};
  let relationships: SplitItem['relationships'] = [];
  for (let [key, member] of Object.entries(value)) {
    let at = `${path}.${key}`;
    let fieldDef = getImmediateFieldDef(definition, key);
    if (!fieldDef) {
      throw new OperationFailure({
        status: 400,
        code: 'invalid-params',
        title: 'Unknown field',
        detail: `the items of this field have no field named "${key}"`,
      });
    }
    if (fieldDef.isComputed) {
      throw new OperationFailure({
        status: 400,
        code: 'invalid-params',
        title: 'Computed field',
        detail:
          `\`${at}\` is computed, so its value comes from its \`computeVia\` ` +
          `rather than from what is stored`,
      });
    }
    if (fieldDef.type === 'linksTo') {
      // The same answer as the collection above: a link an author cleared is
      // stored as a null link rather than refused, so both spellings of "no
      // link" reach the file the way the canonical serialization writes them.
      relationships.push([
        at,
        member == null
          ? emptyLink()
          : storedRelationship(member, target, at, ctx),
      ]);
      continue;
    }
    if (fieldDef.type === 'linksToMany') {
      if (!Array.isArray(member)) {
        throw new OperationFailure({
          status: 400,
          code: 'invalid-params',
          title: 'Invalid link',
          detail: `\`${at}\` holds a collection of links, so it needs a list`,
        });
      }
      if (member.length === 0) {
        // A collection with no members is stored under the field's own key
        // with a null link, which is how the canonical serialization spells a
        // collection an author emptied — and what its deserializer reads to
        // tell that apart from a collection never set. Writing nothing here
        // would store the second when the caller said the first.
        relationships.push([at, emptyLink()]);
        continue;
      }
      member.forEach((link, index) => {
        relationships.push([
          `${at}.${index}`,
          storedRelationship(link, target, `${at}[${index}]`, ctx),
        ]);
      });
      continue;
    }
    if (fieldDef.isPrimitive) {
      stored[key] = member;
      continue;
    }
    let nestedDef = await itemDefinitionOf(fieldDef, key, target.url, ctx);
    if (fieldDef.type === 'contains') {
      if (!isPlainRecord(member)) {
        throw new OperationFailure({
          status: 400,
          code: 'invalid-params',
          title: 'Invalid item',
          detail:
            `\`${at}\` holds a composite value, so it is a record of its ` +
            `fields`,
        });
      }
      let nested = await splitValue(member, nestedDef, at, target, ctx);
      stored[key] = nested.value;
      relationships.push(...nested.relationships);
      continue;
    }
    if (!Array.isArray(member)) {
      throw new OperationFailure({
        status: 400,
        code: 'invalid-params',
        title: 'Invalid item',
        detail: `\`${at}\` holds a collection, so it needs a list`,
      });
    }
    let members: unknown[] = [];
    for (let [index, entry] of member.entries()) {
      if (!isPlainRecord(entry)) {
        throw new OperationFailure({
          status: 400,
          code: 'invalid-params',
          title: 'Invalid item',
          detail:
            `\`${at}[${index}]\` holds a composite value, so it is a record ` +
            `of its fields`,
        });
      }
      let nested = await splitValue(
        entry,
        nestedDef,
        `${at}.${index}`,
        target,
        ctx,
      );
      members.push(nested.value);
      relationships.push(...nested.relationships);
    }
    stored[key] = members;
  }
  return { value: stored, relationships };
}
