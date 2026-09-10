import { cloneDeep, isEqual, merge, mergeWith } from 'lodash-es';
import { v4 as uuidV4 } from 'uuid';

import { visitModuleDeps, type CodeRef } from '../code-ref.ts';
import { getImmediateFieldDef, type Definition } from '../definitions.ts';
import { getCardDirectoryName } from '../helpers/card-directory-name.ts';
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
import { OperationFailure, type OperationDefinition } from './types.ts';
import type { LooseSingleCardDocument } from '../index.ts';
import type { RealmResourceIdentifier } from '../realm-identifiers.ts';
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
  // The fingerprint recorded when the file was last written — the version a
  // caller's `baseVersion` names. Undefined for a file written before the
  // realm began recording one.
  contentHash: string | undefined;
}

// A JSON:API card document as a batch entry carries it. `included` side-loads
// cards to create alongside the primary, each linked to it by its `lid`.
export interface BatchDocument {
  data: CardResource;
  included?: CardResource[];
}

interface EntryCommon {
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

export interface UpdateEntry extends EntryCommon {
  op: 'update';
  // The card being patched, as an absolute URL.
  href: string;
  document: BatchDocument;
}

export interface DeleteEntry extends EntryCommon {
  op: 'delete';
  href: string;
}

export type BatchEntry = CreateEntry | UpdateEntry | DeleteEntry;

// One file the batch will write, and the exact bytes it will hold.
export interface StagedWrite {
  path: LocalPath;
  content: string;
}

// What one executor stages.
export interface StagedChange {
  writes: StagedWrite[];
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
  // Every target's stored file, keyed by local path, read inside the write
  // lock before any executor runs.
  stored: ReadonlyMap<LocalPath, StoredFile>;
  // The invoking actor, as the identity `actor()` resolves to. It comes from
  // the authenticated realm user the request's permission check verified, and
  // is supplied by the endpoint that verified it — an executor never derives
  // an actor itself.
  actor: string;
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
  let localPath = localPathIn(url, ctx);
  let sourcePath = `${localPath}.json` as LocalPath;
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
  // Realm-managed keys never come from a patch: `realmInfo` and `realmURL` are
  // stamped by the realm serving the card, `screenshots` is joined from the
  // prerendered manifest at serve time, and `type` is fixed by the document
  // shape. A client echoing back what it was served must not persist any of
  // them into the source file.
  delete (patch as { type?: unknown }).type;
  delete patch.meta.realmInfo;
  delete patch.meta.realmURL;
  delete patch.meta.screenshots;

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
  if (included.length === 0 && isEqual(primary, original)) {
    // The patch makes no semantic change and side-loads nothing, so the file
    // is left exactly as it is — staging the bytes it already holds is what
    // says so. The commit finds them unchanged, writes nothing, leaves the
    // modification time alone, and queues nothing for indexing, while the
    // entry's result still reports the version the file holds.
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
  // A `.json` file on disk is not by itself a card. `realm.json` is the
  // clearest case — it sits at a URL a delete can name, and removing it would
  // take the realm's own configuration with it — but any stored JSON that is
  // not a card document is one. The bytes already read answer this, so the
  // check costs no read and keeps the just-written card above deletable,
  // which asking the index would not. This is the answer `DELETE` gives for
  // the same URL, where it is the index rather than the bytes that reports no
  // card there.
  if (!cardResourceIn(stored.content)) {
    throw new OperationFailure({
      id: url.href,
      status: 404,
      code: 'target-not-found',
      title: 'Not found',
      detail: `${url.href} is not a card in realm ${ctx.realmURL}`,
    });
  }
  return { writes: [], deletes: [sourcePath], mints: [], id: url.href };
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
        // which is the one outcome worse than a refusal for the mechanism
        // the whole batch exists to provide.
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
  let resource: CardResource = { type: 'card', meta: { adoptsFrom: of } };
  for (let [field, template] of Object.entries(definition.fill ?? {})) {
    let resolved = resolveTemplate(template, {
      entry,
      definition,
      ctx,
      anchor,
      field,
    });
    if (resolved.value === undefined) {
      continue;
    }
    if (resolved.isLink || linkFields.has(field)) {
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
}

interface ResolvedTemplate {
  value: unknown;
  // Whether the template itself declared this a link — a `card(…)` marker, or
  // a param the schema declares as one.
  isLink: boolean;
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
    };
  }
  if (!isMarker(template)) {
    if (template !== null && typeof template === 'object') {
      let value: Record<string, unknown> = {};
      let isLink = false;
      for (let [key, member] of Object.entries(
        template as Record<string, OperationTemplate>,
      )) {
        let resolved = resolveTemplate(member, scope, `${path}.${key}`);
        value[key] = resolved.value;
        isLink ||= resolved.isLink;
      }
      return { value, isLink };
    }
    return { value: template, isLink: false };
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
      // The realm knows the actor by identity, which is what a link to them
      // needs and the only member there is to read.
      if (marker.key !== undefined && marker.key !== 'id') {
        throw new OperationFailure({
          status: 400,
          code: 'invalid-params',
          title: 'Invalid reference',
          detail:
            `\`${path}\` reads actor("${String(marker.key)}"), and the realm ` +
            `knows the actor by identity alone`,
        });
      }
      return { value: ctx.actor, isLink: false };
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
        return { value: anchor.id, isLink: false };
      }
      return {
        value: own(anchor.resource.attributes, String(marker.key)),
        isLink: false,
      };
    }
    case 'card': {
      // The marker says this value is a link whatever it resolves to, so a
      // nested reference is resolved and the result read as an identity.
      let inner = isMarker(marker.value)
        ? resolveMarker(marker.value, scope, path).value
        : marker.value;
      return { value: resolveLinkParam(inner, ctx, path), isLink: true };
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
