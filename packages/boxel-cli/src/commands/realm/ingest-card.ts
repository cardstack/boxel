import type { Command } from 'commander';
import * as path from 'path';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import {
  RealmSyncBase,
  SupportedMimeType,
  type SyncOptions,
} from '../../lib/realm-sync-base';
import {
  CheckpointManager,
  type CheckpointChange,
} from '../../lib/checkpoint-manager';
import { resolveRealmAuthenticator } from '../../lib/auth-resolver';
import { resolveRealmSecretSeed } from '../../lib/prompt';
import {
  getProfileManager,
  type ProfileManager,
} from '../../lib/profile-manager';
import type { RealmAuthenticator } from '../../lib/realm-authenticator';
import { search } from '../search';

const CARD_JSON = 'application/vnd.card+json';
const MODULE_EXTENSIONS = ['.gts', '.gjs', '.ts', '.js'];
const SPEC_MODULE = 'https://cardstack.com/base/spec';

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
 * exists in `fileSet`. Returns null for external specifiers (bare npm,
 * base realm, other realms) — those resolve at runtime and aren't copied.
 */
export function resolveSameRealmFile(
  spec: string,
  fromAbsUrl: string,
  realmRoot: string,
  fileSet: Set<string>,
): string | null {
  let absUrl: string;
  if (spec.startsWith('.') || spec.startsWith('/')) {
    absUrl = new URL(spec, fromAbsUrl).href;
  } else if (/^https?:\/\//.test(spec)) {
    absUrl = spec;
  } else {
    return null; // bare module (npm, @cardstack/*) — external
  }
  if (!absUrl.startsWith(realmRoot)) return null; // base realm / other realm
  let rel = absUrl.slice(realmRoot.length).replace(/^\/+/, '');
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
  private profileManager: ProfileManager;
  private cardUrl: string;
  private sourceCache = new Map<string, string | null>();

  constructor(
    options: SyncOptions & { cardUrl: string },
    authenticator: RealmAuthenticator,
    profileManager: ProfileManager,
  ) {
    super(options, authenticator);
    this.profileManager = profileManager;
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

    // 3. The entry card's own instances.
    let entryModuleAbs = entry.moduleRels.map((r) => this.relToAbs(r));
    let instanceRels = await this.findEntryInstances(
      moduleFiles,
      entryModuleAbs,
      fileSet,
    );
    for (let r of entry.instanceRels) instanceRels.add(r);
    for (let r of instanceRels) toCopy.add(r);

    // 4. The card's own Catalog Spec(s) — card/app specType only.
    let specRels = await this.findCardSpecs(moduleFiles, fileSet);
    for (let r of specRels) toCopy.add(r);

    if (toCopy.size === 0) {
      throw new Error(`Nothing to ingest for ${cardUrl}.`);
    }

    await this.downloadAll([...toCopy], fileSet);
    this.writeCheckpoint();
  }

  /** Classify the entry URL as a module or an instance and seed the crawl. */
  private async resolveEntry(
    cardUrl: string,
    fileSet: Set<string>,
  ): Promise<{ moduleRels: string[]; instanceRels: string[] }> {
    let rel = this.toRel(cardUrl.replace(/\/$/, ''));
    let source = await this.fetchText(rel);
    if (source != null) {
      let doc = tryParseCardDoc(source);
      let adoptsFrom = doc?.data?.meta?.adoptsFrom?.module;
      if (adoptsFrom) {
        // Instance: seed from its definition module, copy the instance.
        let moduleFile = resolveSameRealmFile(
          adoptsFrom,
          this.relToAbs(rel),
          this.realmRoot,
          fileSet,
        );
        let instanceRel = rel.endsWith('.json') ? rel : `${rel}.json`;
        return {
          moduleRels: moduleFile ? [moduleFile] : [],
          instanceRels: fileSet.has(instanceRel) ? [instanceRel] : [],
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
          filter: { type: { module: moduleAbs, name } },
        });
        for (let card of results) {
          let r = this.cardIdToInstanceRel(card.id);
          if (r && fileSet.has(r)) out.add(r);
        }
      }
    }
    return out;
  }

  /** Card/app Spec cards whose `ref` resolves to a seeded module. */
  private async findCardSpecs(
    moduleFiles: Set<string>,
    fileSet: Set<string>,
  ): Promise<Set<string>> {
    let out = new Set<string>();
    let stripExt = (r: string) => r.replace(/\.(gts|gjs|ts|js)$/, '');
    let moduleRelsNoExt = new Set([...moduleFiles].map(stripExt));
    let specs = await this.searchCards({
      filter: { type: { module: SPEC_MODULE, name: 'Spec' } },
    });
    for (let spec of specs) {
      let attrs = spec.attributes ?? {};
      let specType = attrs.specType;
      if (specType !== 'card' && specType !== 'app') continue;
      let ref = attrs.ref as { module?: string } | undefined;
      if (!ref?.module || !spec.id) continue;
      let refRel = stripExt(
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
    let result = await search([this.realmRoot], query, {
      profileManager: this.profileManager,
    });
    if (!result.ok) {
      this.hasError = true;
      console.warn(`  search failed: ${result.error ?? 'unknown'}`);
      return [];
    }
    return (result.data ?? []) as CardResource[];
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

  private writeCheckpoint(): void {
    if (this.options.dryRun || this.copiedFiles.length === 0) return;
    let changes: CheckpointChange[] = this.copiedFiles.map((file) => ({
      file,
      status: 'modified' as const,
    }));
    new CheckpointManager(this.options.localDir)
      .createCheckpoint(
        'remote',
        changes,
        `Ingest card: ${this.copiedFiles.length} files`,
      )
      .then((checkpoint) => {
        if (checkpoint) {
          let tag = checkpoint.isMajor ? '[MAJOR]' : '[minor]';
          console.log(
            `\nCheckpoint created: ${checkpoint.shortHash} ${tag} ${checkpoint.message}`,
          );
        }
      })
      .catch(() => {});
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
}

export async function ingestCard(
  cardUrl: string,
  localDir: string,
  options: IngestCardCommandOptions,
): Promise<{ files: string[]; error?: string }> {
  let pm = options.profileManager ?? getProfileManager();
  let resolution = resolveRealmAuthenticator({
    realmUrl: options.realm ?? cardUrl,
    realmSecretSeed: options.realmSecretSeed,
    profileManager: pm,
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
      pm,
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
