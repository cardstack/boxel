import type { DBAdapter, TypeCoercion } from './db';
import {
  addExplicitParens,
  any,
  dbExpression,
  every,
  param,
  query,
  separatedByCommas,
  type Expression,
} from './expression';
import type { SerializedError } from './error';
import {
  fetchUserPermissions,
  internalKeyFor,
  type Definition,
  type ErrorEntry,
  type ModuleDefinitionResult,
  type ModuleRenderResponse,
  type Prerenderer,
  type Realm,
  type RealmPermissions,
  type ResolvedCodeRef,
  executableExtensions,
  hasExecutableExtension,
  trimExecutableExtension,
} from './index';
import type { VirtualNetwork } from './virtual-network';

const MODULES_TABLE = 'modules';
const PREFERRED_EXECUTABLE_EXTENSIONS = ['.gts', '.ts', '.gjs', '.js'];
const modulesTableCoerceTypes: TypeCoercion = Object.freeze({
  definitions: 'JSON',
  deps: 'JSON',
  error_doc: 'JSON',
});

function canonicalURL(url: string, relativeTo?: string): string {
  try {
    let parsed = new URL(url, relativeTo);
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch (_e) {
    let stripped = url.split('#')[0] ?? url;
    return stripped.split('?')[0] ?? stripped;
  }
}

function normalizeExecutableURL(url: string): string {
  if (!hasExecutableExtension(url)) {
    return url;
  }
  try {
    return trimExecutableExtension(new URL(url)).href;
  } catch (_e) {
    return url;
  }
}

function parseJsonValue<T>(value: T | string | null): T | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch (_err) {
      return null;
    }
  }
  return value as T;
}

export type CacheScope = 'public' | 'realm-auth';
type LocalRealm = Pick<Realm, 'url' | 'getRealmOwnerUserId' | 'visibility'>;

export interface ModuleCacheEntry {
  definitions: Record<string, ModuleDefinitionResult | ErrorEntry>;
  deps: string[];
  error?: ErrorEntry;
  cacheScope: CacheScope;
  authUserId?: string;
  resolvedRealmURL: string;
}

export interface ModuleCacheEntryQuery {
  moduleUrls: string[];
  cacheScope: CacheScope;
  authUserId: string;
  resolvedRealmURL: string;
}

export type ModuleCacheEntries = Record<string, ModuleCacheEntry>;

interface WriteToDatabaseCacheParams {
  moduleUrl: string;
  moduleAlias: string;
  definitions: Record<string, ModuleDefinitionResult | ErrorEntry>;
  deps: string[];
  errorDoc: ErrorEntry | undefined;
  resolvedRealmURL: string;
  cacheScope: CacheScope;
  authUserId: string;
}

export class FilterRefersToNonexistentTypeError extends Error {
  codeRef: ResolvedCodeRef;

  constructor(codeRef: ResolvedCodeRef, opts?: { cause?: unknown }) {
    super(
      `Your filter refers to a nonexistent type: import { ${codeRef.name} } from "${codeRef.module}"`,
    );
    this.name = 'FilterRefersToNonexistentTypeError';
    this.codeRef = codeRef;
    if (opts?.cause !== undefined) {
      (this as any).cause = opts.cause;
    }
    // make sure instances of this Error subclass behave like instances of the subclass should
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
export function isFilterRefersToNonexistentTypeError(
  error: unknown,
): error is FilterRefersToNonexistentTypeError {
  return error instanceof FilterRefersToNonexistentTypeError;
}

export interface DefinitionLookup {
  lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition>;
  invalidate(moduleURL: string): Promise<string[]>;
  clearRealmCache(realmURL: string): Promise<void>;
  registerRealm(realm: LocalRealm): void;
  forRealm(realm: LocalRealm): DefinitionLookup;
  getModuleCacheEntry(moduleUrl: string): Promise<ModuleCacheEntry | undefined>;
  getModuleCacheEntries(
    query: ModuleCacheEntryQuery,
  ): Promise<ModuleCacheEntries>;
}

interface LookupContext {
  requestingRealm?: LocalRealm;
}

export class CachingDefinitionLookup implements DefinitionLookup {
  #dbAdapter: DBAdapter;
  #prerenderer: Prerenderer;
  #fetch: typeof fetch;
  #realms: LocalRealm[] = [];
  #createPrerenderAuth: (
    userId: string,
    permissions: RealmPermissions,
  ) => string;

  constructor(
    dbAdapter: DBAdapter,
    prerenderer: Prerenderer,
    virtualNetwork: VirtualNetwork,
    createPrerenderAuth: (
      userId: string,
      permissions: RealmPermissions,
    ) => string,
  ) {
    this.#dbAdapter = dbAdapter;
    this.#prerenderer = prerenderer;
    this.#fetch = virtualNetwork.fetch;
    this.#createPrerenderAuth = createPrerenderAuth;
  }

  async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
    return await this.lookupDefinitionWithContext(codeRef);
  }

  async getModuleCacheEntry(
    moduleUrl: string,
  ): Promise<ModuleCacheEntry | undefined> {
    let canonicalModuleURL = canonicalURL(moduleUrl);
    let context = await this.buildLookupContext(canonicalModuleURL);
    if (!context) {
      return undefined;
    }
    let {
      realmURL,
      cacheUserId,
      prerenderUserId,
      cacheScope,
      resolvedRealmURL,
    } = context;
    return await this.loadModuleCacheEntry({
      moduleURL: canonicalModuleURL,
      realmURL,
      resolvedRealmURL,
      cacheScope,
      cacheUserId,
      prerenderUserId,
    });
  }

  private async query(expression: Expression, coerceTypes?: TypeCoercion) {
    return await query(this.#dbAdapter, expression, coerceTypes);
  }

  private async loadModuleCacheEntry({
    moduleURL,
    realmURL,
    resolvedRealmURL,
    cacheScope,
    cacheUserId,
    prerenderUserId,
  }: {
    moduleURL: string;
    realmURL: string;
    resolvedRealmURL: string;
    cacheScope: CacheScope;
    cacheUserId: string;
    prerenderUserId: string;
  }): Promise<ModuleCacheEntry | undefined> {
    let cached = await this.readFromDatabaseCache(
      moduleURL,
      cacheScope,
      cacheUserId,
      resolvedRealmURL,
    );
    if (cached) {
      return cached;
    }

    for (let candidateURL of this.populationCandidates(moduleURL)) {
      if (candidateURL !== moduleURL) {
        let candidateCached = await this.readFromDatabaseCache(
          candidateURL,
          cacheScope,
          cacheUserId,
          resolvedRealmURL,
        );
        if (candidateCached) {
          return candidateCached;
        }
      }
      let response = await this.getModuleDefinitionsViaPrerenderer(
        candidateURL,
        realmURL,
        prerenderUserId,
      );
      if (
        response.status === 'error' &&
        this.isMissingModuleError(response, candidateURL)
      ) {
        continue;
      }
      return await this.persistModuleCacheEntry(
        candidateURL,
        response,
        resolvedRealmURL,
        cacheScope,
        prerenderUserId,
      );
    }
    return undefined;
  }

  private populationCandidates(moduleURL: string): string[] {
    if (hasExecutableExtension(moduleURL)) {
      return [moduleURL];
    }
    return [
      ...PREFERRED_EXECUTABLE_EXTENSIONS.map(
        (extension) => `${moduleURL}${extension}`,
      ),
      moduleURL,
    ];
  }

  private isMissingModuleError(
    response: ModuleRenderResponse,
    moduleURL: string,
  ): boolean {
    if (
      response.error?.type !== 'module-error' ||
      response.error.error.status !== 404
    ) {
      return false;
    }
    let deps = response.error.error.deps ?? [];
    if (deps.length === 0) {
      return true;
    }
    let moduleVariants = new Set(this.moduleURLVariants(moduleURL));
    let moduleBaseURL: URL;
    try {
      moduleBaseURL = new URL(moduleURL);
    } catch (_err) {
      return false;
    }
    return deps.every((dep) => {
      let normalizedDep = this.normalizeDependencyForLookup(dep, moduleBaseURL);
      return moduleVariants.has(normalizedDep);
    });
  }

  private async lookupDefinitionWithContext(
    codeRef: ResolvedCodeRef,
    contextOpts?: LookupContext,
  ): Promise<Definition> {
    let canonicalModuleURL = canonicalURL(codeRef.module);
    let canonicalCodeRef =
      canonicalModuleURL === codeRef.module
        ? codeRef
        : { ...codeRef, module: canonicalModuleURL };
    let context = await this.buildLookupContext(
      canonicalModuleURL,
      contextOpts,
    );
    if (!context) {
      throw new FilterRefersToNonexistentTypeError(codeRef, {
        cause: `Could not determine realm owner for module URL: ${codeRef.module}`,
      });
    }
    let {
      realmURL,
      cacheUserId,
      prerenderUserId,
      cacheScope,
      resolvedRealmURL,
    } = context;

    let moduleEntry = await this.loadModuleCacheEntry({
      moduleURL: canonicalModuleURL,
      realmURL,
      resolvedRealmURL,
      cacheScope,
      cacheUserId,
      prerenderUserId,
    });

    if (!moduleEntry) {
      throw new FilterRefersToNonexistentTypeError(codeRef, {
        cause: `Module entry not found for URL: ${codeRef.module}`,
      });
    }

    if (moduleEntry.error) {
      throw new FilterRefersToNonexistentTypeError(codeRef, {
        cause: moduleEntry.error,
      });
    }

    const moduleId = internalKeyFor(canonicalCodeRef, undefined);
    let defOrError = moduleEntry.definitions[moduleId];
    if (!defOrError) {
      throw new FilterRefersToNonexistentTypeError(codeRef, {
        cause: `Definition for ${codeRef.name} in module ${codeRef.module} not found`,
      });
    }

    if (defOrError.type === 'definition') {
      return defOrError.definition;
    }

    throw new FilterRefersToNonexistentTypeError(codeRef, {
      cause: `Definition for ${codeRef.name} in module ${codeRef.module} had an error: ${defOrError.error.message ?? 'unknown error'}`,
    });
  }

  async invalidate(moduleURL: string): Promise<string[]> {
    let canonicalModuleURL = canonicalURL(moduleURL);
    let resolvedRealmURL = this.resolveLocalRealmURL(canonicalModuleURL);
    if (!resolvedRealmURL) {
      return [];
    }
    let visited = new Set<string>();
    let moduleVariants = this.moduleURLVariants(canonicalModuleURL);
    let invalidations = [...moduleVariants];
    for (let moduleVariant of moduleVariants) {
      invalidations.push(
        ...(await this.calculateInvalidations(
          moduleVariant,
          resolvedRealmURL,
          visited,
        )),
      );
    }
    let uniqueInvalidations = [...new Set(invalidations)];
    await this.deleteModuleAliases(resolvedRealmURL, uniqueInvalidations);
    return uniqueInvalidations;
  }

  async clearRealmCache(realmURL: string): Promise<void> {
    await this.query([
      'DELETE FROM',
      MODULES_TABLE,
      'WHERE',
      ...(every([['resolved_realm_url =', param(realmURL)]]) as Expression),
    ]);
  }

  registerRealm(realm: LocalRealm): void {
    this.#realms.push(realm);
  }

  forRealm(realm: LocalRealm): DefinitionLookup {
    this.registerRealm(realm);
    return new RealmScopedDefinitionLookup(this, realm);
  }

  async lookupDefinitionForRealm(
    codeRef: ResolvedCodeRef,
    realm: LocalRealm,
  ): Promise<Definition> {
    return await this.lookupDefinitionWithContext(codeRef, {
      requestingRealm: realm,
    });
  }

  private async buildLookupContext(
    moduleURL: string,
    contextOpts?: LookupContext,
  ): Promise<{
    realmURL: string;
    resolvedRealmURL: string;
    cacheScope: CacheScope;
    cacheUserId: string;
    prerenderUserId: string;
  } | null> {
    let localRealm = this.#realms.find((realm) => {
      return moduleURL.startsWith(realm.url);
    });

    if (localRealm) {
      let prerenderUserId = await localRealm.getRealmOwnerUserId();
      let isPublic = (await localRealm.visibility()) === 'public';
      let cacheScope: CacheScope = isPublic ? 'public' : 'realm-auth';

      return {
        realmURL: localRealm.url,
        resolvedRealmURL: localRealm.url,
        cacheScope,
        cacheUserId: isPublic ? '' : prerenderUserId,
        prerenderUserId,
      };
    } else {
      if (!contextOpts?.requestingRealm) {
        return null;
      }
      let requestingOwnerId =
        (await contextOpts.requestingRealm.getRealmOwnerUserId()) ?? '';
      let authHeaders = { 'X-Boxel-Assume-User': requestingOwnerId };
      let probeResult = await this.probeRemoteRealm(moduleURL, authHeaders);
      let isPublic = probeResult?.isPublic ?? false;
      let resolvedRealmURL = probeResult?.resolvedRealmURL;
      if (!resolvedRealmURL) {
        return null;
      }
      let cacheScope: CacheScope = isPublic ? 'public' : 'realm-auth';

      return {
        realmURL: resolvedRealmURL,
        resolvedRealmURL,
        cacheScope,
        cacheUserId: isPublic ? '' : requestingOwnerId,
        prerenderUserId: requestingOwnerId,
      };
    }
  }

  private async probeRemoteRealm(
    moduleURL: string,
    headers?: HeadersInit,
  ): Promise<{
    isPublic: boolean;
    resolvedRealmURL?: string;
  } | null> {
    try {
      let response = await this.#fetch(moduleURL, {
        method: 'HEAD',
        headers,
      });
      if (!response.ok) {
        return null;
      }
      let publicReadable = response.headers.get(
        'x-boxel-realm-public-readable',
      );
      let resolvedRealmURL =
        response.headers.get('x-boxel-realm-url') ?? undefined;
      return {
        isPublic: Boolean(
          publicReadable &&
          ['true', '1', 'yes'].includes(publicReadable.toLowerCase()),
        ),
        resolvedRealmURL,
      };
    } catch (err) {
      console.warn(
        `Failed to probe remote realm visibility for ${moduleURL}`,
        err,
      );
      return null;
    }
  }

  private async getModuleDefinitionsViaPrerenderer(
    moduleUrl: string,
    realmURL: string,
    userId: string,
  ): Promise<ModuleRenderResponse> {
    let permissions = await fetchUserPermissions(this.#dbAdapter, { userId });
    let auth = this.#createPrerenderAuth(userId, permissions);
    return await this.#prerenderer.prerenderModule({
      realm: realmURL,
      url: moduleUrl,
      auth,
    });
  }

  private async readFromDatabaseCache(
    moduleUrl: string,
    cacheScope: CacheScope,
    authUserId: string,
    resolvedRealmURL: string,
  ): Promise<ModuleCacheEntry | undefined> {
    let moduleAlias = normalizeExecutableURL(moduleUrl);
    let rows = (await this.query(
      [
        'SELECT definitions, deps, error_doc, cache_scope, auth_user_id, resolved_realm_url',
        'FROM',
        MODULES_TABLE,
        'WHERE',
        ...(every([
          ['resolved_realm_url =', param(resolvedRealmURL)],
          ['cache_scope =', param(cacheScope)],
          ['auth_user_id =', param(authUserId)],
          any([
            ['url =', param(moduleUrl)],
            ['file_alias =', param(moduleAlias)],
          ]) as Expression,
        ]) as Expression),
      ],
      modulesTableCoerceTypes,
    )) as {
      definitions: Record<string, ModuleDefinitionResult | ErrorEntry> | null;
      deps: string[] | null;
      error_doc: ErrorEntry | null;
      cache_scope: CacheScope;
      auth_user_id: string | null;
      resolved_realm_url: string | null;
    }[];

    if (!rows.length) {
      return undefined;
    }

    let row = rows[0];
    let definitions =
      parseJsonValue<Record<string, ModuleDefinitionResult | ErrorEntry>>(
        row.definitions,
      ) ?? {};
    let deps = parseJsonValue<string[]>(row.deps) ?? [];
    if (!Array.isArray(deps)) {
      deps = [];
    }
    let error = parseJsonValue<ErrorEntry>(row.error_doc) ?? undefined;
    return {
      definitions,
      deps,
      error,
      cacheScope: row.cache_scope,
      authUserId: row.auth_user_id || undefined,
      resolvedRealmURL: row.resolved_realm_url || '',
    };
  }

  async getModuleCacheEntries(
    query: ModuleCacheEntryQuery,
  ): Promise<ModuleCacheEntries> {
    if (query.moduleUrls.length === 0) {
      return {};
    }
    let candidateUrls = new Set<string>();
    for (let moduleUrl of query.moduleUrls) {
      let canonicalModuleUrl = canonicalURL(moduleUrl);
      candidateUrls.add(canonicalModuleUrl);
      candidateUrls.add(normalizeExecutableURL(canonicalModuleUrl));
    }
    let params = [...candidateUrls].map((moduleUrl) => [param(moduleUrl)]);
    let moduleList = addExplicitParens(separatedByCommas(params)) as Expression;
    let rows = (await this.query(
      [
        'SELECT url, definitions, deps, error_doc, cache_scope, auth_user_id, resolved_realm_url, file_alias',
        'FROM',
        MODULES_TABLE,
        'WHERE',
        ...(every([
          ['resolved_realm_url =', param(query.resolvedRealmURL)],
          ['cache_scope =', param(query.cacheScope)],
          ['auth_user_id =', param(query.authUserId)],
          any([
            ['url IN', ...moduleList],
            ['file_alias IN', ...moduleList],
          ]) as Expression,
        ]) as Expression),
      ],
      modulesTableCoerceTypes,
    )) as {
      url: string;
      file_alias: string | null;
      definitions: Record<string, ModuleDefinitionResult | ErrorEntry> | null;
      deps: string[] | null;
      error_doc: ErrorEntry | null;
      cache_scope: CacheScope;
      auth_user_id: string | null;
      resolved_realm_url: string | null;
    }[];

    let entries: ModuleCacheEntries = {};
    let assignEntry = (key: string, row: (typeof rows)[number]) => {
      let definitions =
        parseJsonValue<Record<string, ModuleDefinitionResult | ErrorEntry>>(
          row.definitions,
        ) ?? {};
      let deps = parseJsonValue<string[]>(row.deps) ?? [];
      if (!Array.isArray(deps)) {
        deps = [];
      }
      let error = parseJsonValue<ErrorEntry>(row.error_doc) ?? undefined;
      let existing = entries[key];
      if (existing && row.cache_scope !== 'realm-auth') {
        return;
      }
      entries[key] = {
        definitions,
        deps,
        error,
        cacheScope: row.cache_scope,
        authUserId: row.auth_user_id || undefined,
        resolvedRealmURL: row.resolved_realm_url || '',
      };
    };
    for (let row of rows) {
      assignEntry(row.url, row);
      if (row.file_alias) {
        assignEntry(row.file_alias, row);
      }
    }

    return entries;
  }

  private async writeToDatabaseCache({
    moduleUrl,
    moduleAlias,
    definitions,
    deps,
    errorDoc,
    resolvedRealmURL,
    cacheScope,
    authUserId,
  }: WriteToDatabaseCacheParams): Promise<void> {
    await this.query([
      'INSERT INTO',
      MODULES_TABLE,
      ...(addExplicitParens(
        separatedByCommas([
          ['url'],
          ['file_alias'],
          ['definitions'],
          ['deps'],
          ['error_doc'],
          ['created_at'],
          ['resolved_realm_url'],
          ['cache_scope'],
          ['auth_user_id'],
        ]),
      ) as Expression),
      'VALUES',
      ...(addExplicitParens(
        separatedByCommas([
          [param(moduleUrl)],
          [param(moduleAlias)],
          [param(JSON.stringify(definitions ?? {}))],
          [param(JSON.stringify(deps ?? []))],
          [param(errorDoc ? JSON.stringify(errorDoc) : null)],
          [param(Date.now())],
          [param(resolvedRealmURL)],
          [param(cacheScope)],
          [param(authUserId)],
        ]),
      ) as Expression),
      'ON CONFLICT ON CONSTRAINT modules_pkey DO UPDATE SET',
      ...(separatedByCommas([
        ['file_alias = excluded.file_alias'],
        ['definitions = excluded.definitions'],
        ['deps = excluded.deps'],
        ['error_doc = excluded.error_doc'],
        ['created_at = excluded.created_at'],
        ['resolved_realm_url = excluded.resolved_realm_url'],
      ]) as Expression),
    ]);
  }

  private async persistModuleCacheEntry(
    moduleUrl: string,
    response: ModuleRenderResponse,
    resolvedRealmURL: string,
    cacheScope: CacheScope,
    userId: string,
  ): Promise<ModuleCacheEntry> {
    let entryURL = new URL(moduleUrl);
    let normalizedDeps = this.normalizeDependencies(
      response.deps ?? [],
      entryURL,
    );
    let errorEntry = response.error ?? undefined;
    if (errorEntry) {
      errorEntry = {
        ...errorEntry,
        error: {
          ...errorEntry.error,
          additionalErrors: errorEntry.error.additionalErrors ?? null,
        },
      };
      errorEntry = this.mergeErrorDeps(errorEntry, normalizedDeps, entryURL);
      errorEntry = await this.appendDependencyErrors(
        errorEntry,
        entryURL,
        resolvedRealmURL,
        cacheScope,
        cacheScope === 'public' ? '' : userId,
      );
    }
    let deps = normalizedDeps;
    if (errorEntry?.error.deps?.length) {
      deps = [...new Set([...deps, ...errorEntry.error.deps])];
    }
    let cacheEntry: ModuleCacheEntry = {
      definitions: response.definitions ?? {},
      deps,
      error: errorEntry,
      cacheScope,
      authUserId: cacheScope === 'public' ? undefined : userId,
      resolvedRealmURL,
    };
    await this.writeToDatabaseCache({
      moduleUrl,
      moduleAlias: normalizeExecutableURL(moduleUrl),
      definitions: cacheEntry.definitions,
      deps: cacheEntry.deps,
      errorDoc: cacheEntry.error,
      resolvedRealmURL,
      cacheScope,
      authUserId: cacheScope === 'public' ? '' : userId,
    });
    return cacheEntry;
  }

  private resolveLocalRealmURL(moduleURL: string): string | null {
    let localRealm = this.#realms.find((realm) =>
      moduleURL.startsWith(realm.url),
    );
    return localRealm?.url ?? null;
  }

  private normalizeDependencyForLookup(dep: string, relativeTo: URL): string {
    let canonical = canonicalURL(dep, relativeTo.href);
    try {
      let url = new URL(canonical);
      if (hasExecutableExtension(url.href)) {
        return trimExecutableExtension(url).href;
      }
      return url.href;
    } catch (_err) {
      return canonical;
    }
  }

  private normalizeDependencies(deps: string[], relativeTo: URL): string[] {
    let normalized = new Set<string>();
    for (let dep of deps ?? []) {
      let value = this.normalizeDependencyForLookup(dep, relativeTo);
      if (value) {
        normalized.add(value);
      }
    }
    return [...normalized];
  }

  private errorKey(error: SerializedError): string {
    return JSON.stringify({
      id: error.id ?? null,
      message: error.message ?? null,
      status: error.status ?? null,
    });
  }

  private async getModuleErrors(
    deps: string[],
    resolvedRealmURL: string,
    cacheScope: CacheScope,
    authUserId: string,
  ): Promise<SerializedError[]> {
    if (deps.length === 0) {
      return [];
    }
    let depList = addExplicitParens(
      separatedByCommas(deps.map((dep) => [param(dep)])),
    ) as Expression;
    let rows = (await this.query(
      [
        'SELECT error_doc',
        'FROM',
        MODULES_TABLE,
        'WHERE',
        ...(every([
          ['resolved_realm_url =', param(resolvedRealmURL)],
          ['cache_scope =', param(cacheScope)],
          ['auth_user_id =', param(authUserId)],
          any([
            ['url IN', ...depList],
            ['file_alias IN', ...depList],
          ]) as Expression,
        ]) as Expression),
      ],
      modulesTableCoerceTypes,
    )) as { error_doc: ErrorEntry | null }[];

    let errors: SerializedError[] = [];
    for (let row of rows) {
      if (!row.error_doc?.error) {
        continue;
      }
      let normalized = {
        ...row.error_doc.error,
        additionalErrors: row.error_doc.error.additionalErrors ?? null,
      };
      errors.push(normalized);
    }
    return errors;
  }

  private async collectModuleErrors(
    deps: string[],
    relativeTo: URL,
    resolvedRealmURL: string,
    cacheScope: CacheScope,
    authUserId: string,
  ): Promise<SerializedError[]> {
    let pending = new Set<string>();
    let visited = new Set<string>();
    let enqueue = (dep: string, base: URL) => {
      let normalized = this.normalizeDependencyForLookup(dep, base);
      if (!normalized || normalized.endsWith('.json')) {
        return;
      }
      if (visited.has(normalized)) {
        return;
      }
      visited.add(normalized);
      pending.add(normalized);
    };

    for (let dep of deps) {
      enqueue(dep, relativeTo);
    }

    let collected: SerializedError[] = [];
    let seenErrors = new Set<string>();

    while (pending.size > 0) {
      let batchDeps = [...pending];
      pending.clear();
      let errors = await this.getModuleErrors(
        batchDeps,
        resolvedRealmURL,
        cacheScope,
        authUserId,
      );
      for (let error of errors) {
        let key = this.errorKey(error);
        if (!seenErrors.has(key)) {
          collected.push(error);
          seenErrors.add(key);
        }
        let base = relativeTo;
        if (error.id) {
          try {
            base = new URL(error.id);
          } catch (_err) {
            base = relativeTo;
          }
        }
        for (let dep of error.deps ?? []) {
          enqueue(dep, base);
        }
      }
    }

    return collected;
  }

  private async appendDependencyErrors(
    entry: ErrorEntry,
    entryURL: URL,
    resolvedRealmURL: string,
    cacheScope: CacheScope,
    authUserId: string,
  ): Promise<ErrorEntry> {
    let deps = entry.error.deps ?? [];
    if (deps.length === 0) {
      return entry;
    }
    let dependencyErrors = await this.collectModuleErrors(
      deps,
      entryURL,
      resolvedRealmURL,
      cacheScope,
      authUserId,
    );
    if (dependencyErrors.length === 0) {
      return entry;
    }

    let existing = Array.isArray(entry.error.additionalErrors)
      ? [...entry.error.additionalErrors]
      : [];
    let seen = new Set(existing.map((error) => this.errorKey(error)));
    seen.add(this.errorKey(entry.error));
    let added = false;
    for (let error of dependencyErrors) {
      let key = this.errorKey(error);
      if (!seen.has(key)) {
        existing.push(error);
        seen.add(key);
        added = true;
      }
    }
    if (!added) {
      return entry;
    }
    return {
      ...entry,
      error: {
        ...entry.error,
        additionalErrors: existing,
      },
    };
  }

  private mergeErrorDeps(
    entry: ErrorEntry,
    deps: string[] | undefined,
    relativeTo: URL,
  ): ErrorEntry {
    if (!deps || deps.length === 0) {
      return entry;
    }
    let normalizedDeps = deps
      .map((dep) => this.normalizeDependencyForLookup(dep, relativeTo))
      .filter(Boolean);
    let merged = new Set([...(entry.error.deps ?? []), ...normalizedDeps]);
    return {
      ...entry,
      error: {
        ...entry.error,
        deps: [...merged],
      },
    };
  }

  private async itemsThatReference(
    moduleAliases: string[],
    resolvedRealmURL: string,
  ): Promise<{ url: string; alias: string }[]> {
    if (moduleAliases.length === 0) {
      return [];
    }
    let moduleAliasList = addExplicitParens(
      separatedByCommas(
        moduleAliases.map((moduleAlias) => [param(moduleAlias)]),
      ),
    ) as Expression;
    let rows = (await this.query([
      'SELECT DISTINCT url, file_alias',
      'FROM',
      MODULES_TABLE,
      dbExpression({
        pg: `CROSS JOIN LATERAL jsonb_array_elements_text(
               COALESCE(deps, '[]'::jsonb)
             ) AS dep(value)`,
        sqlite: `CROSS JOIN json_each(COALESCE(deps, '[]')) AS dep`,
      }),
      'WHERE',
      ...(every([
        ['resolved_realm_url =', param(resolvedRealmURL)],
        ['dep.value IN', ...moduleAliasList],
      ]) as Expression),
    ])) as { url: string; file_alias: string | null }[];

    return rows.map((row) => ({
      url: row.url,
      alias: row.file_alias ?? row.url,
    }));
  }

  private async calculateInvalidations(
    moduleAlias: string,
    resolvedRealmURL: string,
    visited: Set<string>,
  ): Promise<string[]> {
    let moduleKey = this.moduleKey(moduleAlias);
    if (!moduleKey || visited.has(moduleKey)) {
      return [];
    }
    visited.add(moduleKey);
    let consumers = await this.itemsThatReference(
      this.moduleURLVariants(moduleAlias),
      resolvedRealmURL,
    );
    let invalidations: string[] = [];
    for (let consumer of consumers) {
      invalidations.push(consumer.url);
      if (consumer.alias && consumer.alias !== consumer.url) {
        invalidations.push(consumer.alias);
      }
      if (consumer.alias) {
        invalidations.push(
          ...(await this.calculateInvalidations(
            consumer.alias,
            resolvedRealmURL,
            visited,
          )),
        );
      }
    }
    return invalidations;
  }

  private moduleKey(moduleURL: string): string | undefined {
    let canonical = canonicalURL(moduleURL);
    if (!canonical) {
      return undefined;
    }
    return normalizeExecutableURL(canonical);
  }

  private moduleURLVariants(moduleURL: string): string[] {
    let canonical = canonicalURL(moduleURL);
    if (!canonical) {
      return [];
    }
    let variants = new Set<string>();
    variants.add(canonical);
    let alias = normalizeExecutableURL(canonical);
    if (alias) {
      variants.add(alias);
      // Also consider extension-based variants so callers can invalidate
      // module cache rows regardless of whether they have a file extension.
      if (!canonical.endsWith('/')) {
        for (let extension of executableExtensions) {
          variants.add(`${alias}${extension}`);
        }
      }
    }
    return [...variants];
  }

  private async deleteModuleAliases(
    resolvedRealmURL: string,
    moduleAliases: string[],
  ): Promise<void> {
    if (moduleAliases.length === 0) {
      return;
    }
    let aliasList = addExplicitParens(
      separatedByCommas(moduleAliases.map((alias) => [param(alias)])),
    ) as Expression;
    await this.query([
      'DELETE FROM',
      MODULES_TABLE,
      'WHERE',
      ...(every([
        ['resolved_realm_url =', param(resolvedRealmURL)],
        any([
          ['url IN', ...aliasList],
          ['file_alias IN', ...aliasList],
        ]) as Expression,
      ]) as Expression),
    ]);
  }
}

export interface RealmOwnerLookup {
  fromModule(
    moduleURL: string,
  ): Promise<{ realmURL: string; userId: string } | null>;
}

class RealmScopedDefinitionLookup implements DefinitionLookup {
  #inner: CachingDefinitionLookup;
  #realm: LocalRealm;

  constructor(inner: CachingDefinitionLookup, realm: LocalRealm) {
    this.#inner = inner;
    this.#realm = realm;
  }

  async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
    return await this.#inner.lookupDefinitionForRealm(codeRef, this.#realm);
  }

  async invalidate(moduleURL: string): Promise<string[]> {
    return await this.#inner.invalidate(moduleURL);
  }

  async clearRealmCache(realmURL: string): Promise<void> {
    await this.#inner.clearRealmCache(realmURL);
  }

  registerRealm(realm: LocalRealm): void {
    this.#inner.registerRealm(realm);
  }

  forRealm(realm: LocalRealm): DefinitionLookup {
    return this.#inner.forRealm(realm);
  }

  async getModuleCacheEntry(
    moduleUrl: string,
  ): Promise<ModuleCacheEntry | undefined> {
    return await this.#inner.getModuleCacheEntry(moduleUrl);
  }

  async getModuleCacheEntries(
    query: ModuleCacheEntryQuery,
  ): Promise<ModuleCacheEntries> {
    return await this.#inner.getModuleCacheEntries(query);
  }
}
