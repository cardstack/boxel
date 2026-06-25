import type { Command } from 'commander';
import * as path from 'path';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import {
  RealmSyncBase,
  SupportedMimeType,
  type SyncOptions,
} from '../../lib/realm-sync-base.ts';
import {
  CheckpointManager,
  type CheckpointChange,
} from '../../lib/checkpoint-manager.ts';
import { resolveRealmAuthenticator } from '../../lib/auth-resolver.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import {
  getProfileManager,
  type ProfileManager,
} from '../../lib/profile-manager.ts';
import type { RealmAuthenticator } from '../../lib/realm-authenticator.ts';
import { searchEntryRequestBody, itemsFromSearchEntryDoc } from '../search.ts';

const CARD_JSON = 'application/vnd.card+json';
const MODULE_EXTENSIONS = ['.gts', '.gjs', '.ts', '.js'];
const SPEC_MODULE = 'https://cardstack.com/base/spec';

/**
 * The realm index identifies modules without their executable extension;
 * strip it whenever a module path is used in a type filter or compared
 * against an indexed module reference.
 */
function stripModuleExt(moduleRelOrUrl: string): string {
  return moduleRelOrUrl.replace(/\.(gts|gjs|ts|js)$/, '');
}

/**
 * Pull every module-specifier out of `.gts`/`.ts` source text. Matches the
 * `from '<spec>'` clause of every `import`/`export … from` (value **and**
 * `import type`, namespace, re-export) plus side-effect `import '<spec>'`.
 * Type-only imports matter: they are erased at transpile, so the realm's
 * runtime dep graph misses them — yet the seeded copy still needs the file
 * on disk for `boxel parse` to type-check.
 */
export function extractImportSpecifiers(source: string): string[] {
  let specs = new Set<string>();
  let fromRe = /\bfrom\s*['"]([^'"]+)['"]/g;
  let sideEffectRe = /\bimport\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(source))) specs.add(m[1]);
  while ((m = sideEffectRe.exec(source))) specs.add(m[1]);
  return [...specs];
}

/**
 * Non-null `relationships.*.links.self` values from a card instance's JSON —
 * the `linksTo` / `linksToMany` targets to follow when crawling an instance's
 * link graph. `linksToMany` serializes as `field.0`, `field.1`, … each with its
 * own `links.self`; unset links are `null` and skipped.
 */
export function extractRelationshipLinks(source: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return [];
  }
  let rels = (parsed as { data?: { relationships?: Record<string, unknown> } })
    ?.data?.relationships;
  if (!rels || typeof rels !== 'object') {
    return [];
  }
  let out: string[] = [];
  for (let value of Object.values(rels)) {
    let self = (value as { links?: { self?: unknown } })?.links?.self;
    if (typeof self === 'string' && self) {
      out.push(self);
    }
  }
  return out;
}

/** Exported card/field class names declared in a module (for instance lookup). */
export function extractExportedClassNames(source: string): string[] {
  let names = new Set<string>();
  let re =
    /\bexport\s+(?:default\s+)?(?:abstract\s+)?class\s+(\w+)\s+extends\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) names.add(m[1]);
  return [...names];
}

/**
 * Resolve a same-realm import specifier to a realm-relative file path that
 * exists in `fileSet`. Handles relative (`./`, `../`), same-origin absolute
 * (`https://…/<realm>/…`), and registered-prefix (`@cardstack/<realm>/…`)
 * forms. Returns null for anything outside this realm (base realm, other
 * realms, bare npm packages) — those resolve at runtime and aren't copied.
 */
export function resolveSameRealmFile(
  spec: string,
  fromAbsUrl: string,
  realmRoot: string,
  fileSet: Set<string>,
): string | null {
  let rel: string;
  if (spec.startsWith('.') || spec.startsWith('/')) {
    let absUrl = new URL(spec, fromAbsUrl).href;
    if (!absUrl.startsWith(realmRoot)) return null; // base realm / other realm
    rel = absUrl.slice(realmRoot.length).replace(/^\/+/, '');
  } else if (/^https?:\/\//.test(spec)) {
    if (!spec.startsWith(realmRoot)) return null;
    rel = spec.slice(realmRoot.length).replace(/^\/+/, '');
  } else if (spec.startsWith('@')) {
    // Registered-prefix form (`@cardstack/<realm>/…`). Map onto this realm by
    // its path tail (e.g. `catalog/`). npm-scoped packages (`@glimmer/…`)
    // won't contain the realm tail and fall through to null (external).
    let tail = new URL(realmRoot).pathname.replace(/^\/+/, '');
    let idx = tail ? spec.indexOf(tail) : -1;
    if (idx < 0) return null;
    rel = spec.slice(idx + tail.length).replace(/^\/+/, '');
  } else {
    return null; // bare npm module — external
  }
  let candidates = MODULE_EXTENSIONS.some((ext) => rel.endsWith(ext))
    ? [rel]
    : [rel, ...MODULE_EXTENSIONS.map((ext) => rel + ext)];
  for (let cand of candidates) {
    if (fileSet.has(cand)) return cand;
  }
  return null;
}

class RealmCardIngester extends RealmSyncBase {
  hasError = false;
  copiedFiles: string[] = [];
  private cardUrl: string;
  private sourceCache = new Map<string, string | null>();

  constructor(
    options: SyncOptions & { cardUrl: string },
    authenticator: RealmAuthenticator,
  ) {
    super(options, authenticator);
    this.cardUrl = options.cardUrl;
  }

  private get realmRoot(): string {
    return this.normalizedRealmUrl; // always ends with '/'
  }

  private relToAbs(rel: string): string {
    return this.realmRoot + rel.replace(/^\/+/, '');
  }

  private toRel(absUrl: string): string {
    return absUrl.startsWith(this.realmRoot)
      ? absUrl.slice(this.realmRoot.length).replace(/^\/+/, '')
      : absUrl;
  }

  /**
   * Normalize any reference to a realm-relative path. The realm is reachable
   * under two URL spaces: the served root (`https://…/catalog/`, used by file
   * I/O and `_mtimes`) and a published alias (`@cardstack/catalog/`, used by
   * search-result `id`s and `ref.module`). Both share the realm's path tail
   * (`catalog/`), so we relativize against that.
   */
  private relativize(url: string): string {
    if (url.startsWith(this.realmRoot)) {
      return url.slice(this.realmRoot.length).replace(/^\/+/, '');
    }
    let tail = new URL(this.realmRoot).pathname.replace(/^\/+/, ''); // e.g. catalog/
    let idx = tail ? url.indexOf(tail) : -1;
    if (idx >= 0) return url.slice(idx + tail.length).replace(/^\/+/, '');
    return url.replace(/^\/+/, '');
  }

  /** Resolve a module ref (absolute alias/https or relative) to a realm-relative path. */
  private refToRel(refModule: string, baseRel: string): string {
    if (/^https?:\/\//.test(refModule) || refModule.startsWith('@')) {
      return this.relativize(refModule);
    }
    return new URL(refModule, `https://_/${baseRel}`).pathname.replace(
      /^\/+/,
      '',
    );
  }

  /** Fetch a realm file's source text (cached). Null on non-OK. */
  private async fetchText(rel: string): Promise<string | null> {
    if (this.sourceCache.has(rel)) return this.sourceCache.get(rel)!;
    let res = await this.authenticator.authedRealmFetch(
      this.buildFileUrl(rel),
      {
        headers: { Accept: SupportedMimeType.CardSource },
      },
    );
    let text = res.ok ? await res.text() : null;
    this.sourceCache.set(rel, text);
    return text;
  }

  async sync(): Promise<void> {
    let cardUrl = this.cardUrl;
    let fileSet = new Set((await this.getRemoteMtimes()).keys());
    if (fileSet.size === 0) {
      throw new Error(
        `Source realm ${this.realmRoot} returned no files (check the URL and your access).`,
      );
    }

    let toCopy = new Set<string>();
    let entry = await this.resolveEntry(cardUrl, fileSet);

    // 1. Module dependency graph (static imports, transitive, same-realm).
    let moduleFiles = await this.crawlModules(entry.moduleRels, fileSet);
    for (let f of moduleFiles) toCopy.add(f);

    // 2. Co-located tests for every seeded module.
    for (let f of moduleFiles) {
      let test = f.replace(/\.(gts|gjs|ts|js)$/, '.test.$1');
      if (test !== f && fileSet.has(test)) toCopy.add(test);
    }

    // 3. Instances. A module entry means "the card type" → copy every
    //    instance of it. An instance entry means "this record" → copy just it
    //    and the records it links to (transitively), not unrelated siblings.
    let instanceRels: Set<string>;
    if (entry.instanceRels.length > 0) {
      instanceRels = await this.crawlInstanceLinks(entry.instanceRels, fileSet);
    } else {
      let entryModuleAbs = entry.moduleRels.map((r) => this.relToAbs(r));
      instanceRels = await this.findEntryInstances(
        moduleFiles,
        entryModuleAbs,
        fileSet,
      );
    }
    for (let r of instanceRels) toCopy.add(r);

    // 4. The card's own Catalog Spec(s) — card/app specType only.
    let specRels = await this.findCardSpecs(moduleFiles, fileSet);
    for (let r of specRels) toCopy.add(r);

    if (toCopy.size === 0) {
      throw new Error(`Nothing to ingest for ${cardUrl}.`);
    }

    await this.downloadAll([...toCopy], fileSet);
    await this.writeCheckpoint();
  }

  /** Classify the entry URL as a module or an instance and seed the crawl. */
  private async resolveEntry(
    cardUrl: string,
    fileSet: Set<string>,
  ): Promise<{ moduleRels: string[]; instanceRels: string[] }> {
    let rel = this.toRel(cardUrl.replace(/\/$/, ''));
    // Instance? Canonical instance URLs omit the `.json` (e.g. `.../Person/1`),
    // so probe the `.json` file rather than the bare path (which 404s).
    let instanceRel = rel.endsWith('.json') ? rel : `${rel}.json`;
    if (fileSet.has(instanceRel)) {
      let source = await this.fetchText(instanceRel);
      let adoptsFrom =
        source != null
          ? tryParseCardDoc(source)?.data?.meta?.adoptsFrom?.module
          : undefined;
      if (adoptsFrom) {
        // Instance: seed from its definition module, copy the instance.
        let moduleFile = resolveSameRealmFile(
          adoptsFrom,
          this.relToAbs(instanceRel),
          this.realmRoot,
          fileSet,
        );
        return {
          moduleRels: moduleFile ? [moduleFile] : [],
          instanceRels: [instanceRel],
        };
      }
    }
    // Module: resolve to a real source file.
    let moduleFile = resolveSameRealmFile(
      cardUrl,
      this.realmRoot,
      this.realmRoot,
      fileSet,
    );
    if (!moduleFile) {
      throw new Error(
        `Could not resolve ${cardUrl} to a module or instance in ${this.realmRoot}.`,
      );
    }
    return { moduleRels: [moduleFile], instanceRels: [] };
  }

  /** BFS the same-realm import graph from the seed modules. */
  private async crawlModules(
    seeds: string[],
    fileSet: Set<string>,
  ): Promise<Set<string>> {
    let seen = new Set<string>();
    let queue = [...seeds];
    while (queue.length) {
      let rel = queue.shift()!;
      if (seen.has(rel)) continue;
      seen.add(rel);
      let source = await this.fetchText(rel);
      if (source == null) continue;
      for (let spec of extractImportSpecifiers(source)) {
        let dep = resolveSameRealmFile(
          spec,
          this.relToAbs(rel),
          this.realmRoot,
          fileSet,
        );
        if (dep && !seen.has(dep)) queue.push(dep);
      }
    }
    return seen;
  }

  /** Instances whose definition is one of the entry module's exported cards. */
  private async findEntryInstances(
    moduleFiles: Set<string>,
    entryModuleAbs: string[],
    fileSet: Set<string>,
  ): Promise<Set<string>> {
    let out = new Set<string>();
    for (let rel of moduleFiles) {
      let moduleAbs = this.relToAbs(rel);
      if (!entryModuleAbs.includes(moduleAbs)) continue;
      let source = await this.fetchText(rel);
      if (source == null) continue;
      for (let name of extractExportedClassNames(source)) {
        let results = await this.searchCards({
          filter: { type: { module: stripModuleExt(moduleAbs), name } },
        });
        for (let card of results) {
          let r = this.cardIdToInstanceRel(card.id);
          if (r && fileSet.has(r)) out.add(r);
        }
      }
    }
    return out;
  }

  /**
   * BFS the same-realm link graph from the seed instances: each instance plus
   * every instance it references via `linksTo` / `linksToMany`, transitively.
   * The instance analogue of `crawlModules` — for an instance entry we copy
   * that record and the records it links to (e.g. a cellar and its bottles),
   * but not unrelated siblings of the same type.
   */
  private async crawlInstanceLinks(
    seeds: string[],
    fileSet: Set<string>,
  ): Promise<Set<string>> {
    let seen = new Set<string>();
    let queue = [...seeds];
    while (queue.length) {
      let rel = queue.shift()!;
      if (seen.has(rel)) continue;
      seen.add(rel);
      let source = await this.fetchText(rel);
      if (source == null) continue;
      for (let self of extractRelationshipLinks(source)) {
        let linked = this.resolveLinkedInstanceRel(self, rel, fileSet);
        if (linked && !seen.has(linked)) queue.push(linked);
      }
    }
    return seen;
  }

  /**
   * Resolve a relationship `links.self` (relative `../Foo/x`, published alias
   * `@cardstack/<realm>/…`, or absolute https — and without a `.json` extension)
   * to a same-realm instance file that exists in `fileSet`, or null for
   * cross-realm / missing links.
   */
  private resolveLinkedInstanceRel(
    self: string,
    fromRel: string,
    fileSet: Set<string>,
  ): string | null {
    let rel: string;
    if (self.startsWith('@')) {
      // Published-alias form — map onto this realm by its path tail. A tail
      // that isn't ours (another realm's alias) won't resolve to a local file.
      rel = this.relativize(self);
    } else {
      // Relative or absolute https: resolve to an absolute URL and require it
      // to live under THIS realm's served root. A link into another realm —
      // even one whose URL happens to share our path tail — is left as a
      // runtime reference, not copied (mirrors resolveSameRealmFile).
      let absUrl = /^https?:\/\//.test(self)
        ? self
        : new URL(self, this.relToAbs(fromRel)).href;
      if (!absUrl.startsWith(this.realmRoot)) {
        return null;
      }
      rel = absUrl.slice(this.realmRoot.length).replace(/^\/+/, '');
    }
    let candidate = rel.endsWith('.json') ? rel : `${rel}.json`;
    return fileSet.has(candidate) ? candidate : null;
  }

  /** Card/app Spec cards whose `ref` resolves to a seeded module. */
  private async findCardSpecs(
    moduleFiles: Set<string>,
    fileSet: Set<string>,
  ): Promise<Set<string>> {
    let out = new Set<string>();
    let moduleRelsNoExt = new Set([...moduleFiles].map(stripModuleExt));
    let specs = await this.searchCards({
      filter: { type: { module: SPEC_MODULE, name: 'Spec' } },
    });
    for (let spec of specs) {
      let attrs = spec.attributes ?? {};
      let specType = attrs.specType;
      if (specType !== 'card' && specType !== 'app') continue;
      let ref = attrs.ref as { module?: string } | undefined;
      if (!ref?.module || !spec.id) continue;
      let refRel = stripModuleExt(
        this.refToRel(ref.module, this.relativize(spec.id)),
      );
      if (!moduleRelsNoExt.has(refRel)) continue;
      let r = this.cardIdToInstanceRel(spec.id);
      if (r && fileSet.has(r)) out.add(r);
    }
    return out;
  }

  private async searchCards(
    query: Record<string, unknown>,
  ): Promise<CardResource[]> {
    // Query the SOURCE realm's own `_search-v2` directly rather than the
    // profile-scoped federated search. A shared/published source realm (e.g.
    // the catalog) isn't in the active profile's federated set, so federated
    // search returns nothing for it — which is why instances and Specs went
    // uncopied (the module crawl survives because it uses direct file fetches).
    // The realm's own endpoint sees its full index. The request is data-only
    // (`fields[search-entry]=item`); the response is a search-entry document
    // whose matched `item` serializations resolve out of `included` uniformly
    // for normal and published realms (the v1 `data`-vs-`included` split
    // disappears — every match is an entry that references its item).
    let res = await this.authenticator.authedRealmFetch(
      `${this.realmRoot}_search-v2`,
      {
        method: 'QUERY',
        headers: {
          Accept: CARD_JSON,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(searchEntryRequestBody(query)),
      },
    );
    if (!res.ok) {
      this.hasError = true;
      // Include statusText + a body snippet so auth errors, malformed queries,
      // etc. are diagnosable from the CLI output, not just a bare status code.
      let body = await res.text().catch(() => '');
      console.warn(
        `  search failed: HTTP ${res.status} ${res.statusText}`.trimEnd() +
          (body ? ` — ${body.slice(0, 300)}` : ''),
      );
      return [];
    }
    let json = (await res.json()) as Parameters<
      typeof itemsFromSearchEntryDoc
    >[0];
    return itemsFromSearchEntryDoc(json) as unknown as CardResource[];
  }

  private cardIdToInstanceRel(id: string | undefined): string | null {
    if (!id) return null;
    let rel = this.relativize(id);
    if (!rel) return null;
    return rel.endsWith('.json') ? rel : `${rel}.json`;
  }

  private async downloadAll(
    rels: string[],
    _fileSet: Set<string>,
  ): Promise<void> {
    let results = await Promise.all(
      rels.map((rel) =>
        this.remoteLimit(async () => {
          try {
            await this.downloadFile(rel, path.join(this.options.localDir, rel));
            return rel;
          } catch (error) {
            this.hasError = true;
            console.error(`Error downloading ${rel}:`, error);
            return null;
          }
        }),
      ),
    );
    this.copiedFiles = results.filter((r): r is string => r !== null);
  }

  /**
   * Best-effort: a checkpoint failure (e.g. unwritable history dir) is
   * warned about but doesn't fail the ingest — the files are already copied.
   */
  private async writeCheckpoint(): Promise<void> {
    if (this.options.dryRun || this.copiedFiles.length === 0) return;
    let changes: CheckpointChange[] = this.copiedFiles.map((file) => ({
      file,
      status: 'modified' as const,
    }));
    try {
      let checkpoint = await new CheckpointManager(
        this.options.localDir,
      ).createCheckpoint(
        'remote',
        changes,
        `Ingest card: ${this.copiedFiles.length} files`,
      );
      if (checkpoint) {
        let tag = checkpoint.isMajor ? '[MAJOR]' : '[minor]';
        console.log(
          `\nCheckpoint created: ${checkpoint.shortHash} ${tag} ${checkpoint.message}`,
        );
      }
    } catch (error) {
      console.warn(
        `Warning: failed to create checkpoint: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

interface CardResource {
  id?: string;
  attributes?: { specType?: string; ref?: unknown; [k: string]: unknown };
}

function tryParseCardDoc(
  source: string,
): { data?: { meta?: { adoptsFrom?: { module?: string } } } } | null {
  try {
    let parsed = JSON.parse(source);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export interface IngestCardCommandOptions {
  realm?: string;
  dryRun?: boolean;
  realmSecretSeed?: string;
  profileManager?: ProfileManager;
  /**
   * @internal Test hook: supply an already-constructed authenticator,
   * bypassing both seed resolution and the profile flow.
   */
  authenticator?: RealmAuthenticator;
}

export async function ingestCard(
  cardUrl: string,
  localDir: string,
  options: IngestCardCommandOptions,
): Promise<{ files: string[]; error?: string }> {
  // A card URL never ends in a slash; strip one a copy-paste may have added.
  // It would otherwise skew seed-auth registration (a token scoped to the
  // card path rather than the realm) and realm auto-detection below.
  cardUrl = cardUrl.replace(/\/$/, '');
  let pm = options.profileManager ?? getProfileManager();
  let resolution = resolveRealmAuthenticator({
    realmUrl: options.realm ?? cardUrl,
    realmSecretSeed: options.realmSecretSeed,
    profileManager: pm,
    authenticator: options.authenticator,
  });
  if (!resolution.ok) return { files: [], error: resolution.error };
  let authenticator = resolution.authenticator;

  let realmRoot = options.realm
    ? ensureTrailingSlash(options.realm)
    : undefined;
  if (!realmRoot) {
    try {
      let res = await authenticator.authedRealmFetch(cardUrl, {
        headers: { Accept: CARD_JSON },
      });
      let header = res.headers.get('x-boxel-realm-url');
      if (header) realmRoot = ensureTrailingSlash(header);
    } catch {
      // fall through to the error below
    }
    if (!realmRoot) {
      return {
        files: [],
        error: `Could not determine the source realm for ${cardUrl}. Pass --realm <source-realm-url>.`,
      };
    }
  }

  try {
    let ingester = new RealmCardIngester(
      {
        realmUrl: realmRoot,
        localDir,
        dryRun: options.dryRun,
        cardUrl,
      },
      authenticator,
    );
    console.log(
      `Ingesting ${cardUrl}\n  from realm ${realmRoot}\n  into ${localDir}`,
    );
    await ingester.sync();
    console.log(`\nIngested ${ingester.copiedFiles.length} file(s).`);
    return {
      files: ingester.copiedFiles.sort(),
      error: ingester.hasError
        ? 'Ingest completed with errors — some files may be missing.'
        : undefined,
    };
  } catch (error) {
    return {
      files: [],
      error: `Ingest failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function registerIngestCardCommand(realm: Command): void {
  realm
    .command('ingest-card')
    .description(
      'Copy a card from a source realm into a local directory, bundling the ' +
        "deps that live in the card's own realm: the module, the modules it " +
        'imports from the same realm, its sample instances, and its Catalog ' +
        'Spec. Imports that resolve to the base realm or other realms are ' +
        'left as references (they resolve at runtime). Works across realms; ' +
        'source and target must be on the same realm server.',
    )
    .argument(
      '<source-card-url>',
      'Absolute URL of the source card module (or a card instance) to ingest',
    )
    .argument(
      '<local-dir>',
      'The local directory to write the card + deps into',
    )
    .option(
      '--realm <url>',
      'Source realm URL (defaults to the realm the card belongs to)',
    )
    .option('--dry-run', 'Show what would be copied without writing files')
    .option(
      '--realm-secret-seed',
      'Administrative auth: prompt for a realm secret seed and mint a JWT locally (env: BOXEL_REALM_SECRET_SEED)',
    )
    .action(
      async (
        sourceCardUrl: string,
        localDir: string,
        options: {
          realm?: string;
          dryRun?: boolean;
          realmSecretSeed?: boolean;
        },
      ) => {
        let realmSecretSeed = await resolveRealmSecretSeed(
          options.realmSecretSeed === true,
        );
        let result = await ingestCard(sourceCardUrl, localDir, {
          realm: options.realm,
          dryRun: options.dryRun,
          realmSecretSeed,
        });
        if (result.error) {
          console.error(`Error: ${result.error}`);
          process.exit(result.files.length > 0 ? 2 : 1);
        }
        console.log('Ingest completed successfully');
      },
    );
}
