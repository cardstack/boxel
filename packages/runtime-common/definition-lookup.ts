import type { DBAdapter, TypeCoercion } from './db';
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
} from './index';
import type { VirtualNetwork } from './virtual-network';

const MODULES_TABLE = 'modules';
const modulesTableCoerceTypes: TypeCoercion = Object.freeze({
  definitions: 'JSON',
  deps: 'JSON',
  error_doc: 'JSON',
});

type CacheScope = 'public' | 'realm-auth';
type LocalRealm = Pick<Realm, 'url' | 'getRealmOwnerUserId' | 'visibility'>;

interface ModuleCacheEntry {
  definitions: Record<string, ModuleDefinitionResult | ErrorEntry>;
  deps: string[];
  error?: ErrorEntry;
  cacheScope: CacheScope;
  authUserId?: string;
  resolvedRealmURL: string;
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
  invalidate(realmURL: string): Promise<void>;
  registerRealm(realm: LocalRealm): void;
  forRealm(realm: LocalRealm): DefinitionLookup;
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

  private async lookupDefinitionWithContext(
    codeRef: ResolvedCodeRef,
    contextOpts?: LookupContext,
  ): Promise<Definition> {
    let context = await this.buildLookupContext(codeRef.module, contextOpts);
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

    let moduleEntry =
      (await this.readFromDatabaseCache(
        codeRef.module,
        cacheScope,
        cacheUserId,
      )) ??
      (await this.populateCache(
        codeRef.module,
        realmURL,
        resolvedRealmURL,
        prerenderUserId,
        cacheScope,
      ));

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

    const moduleId = internalKeyFor(codeRef, undefined);
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

  async invalidate(realmURL: string): Promise<void> {
    await this.#dbAdapter.execute(
      `DELETE FROM ${MODULES_TABLE} WHERE resolved_realm_url = $1`,
      { bind: [realmURL] },
    );
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
  ): Promise<ModuleCacheEntry | undefined> {
    let rows = (await this.#dbAdapter.execute(
      `SELECT definitions, deps, error_doc, cache_scope, auth_user_id, resolved_realm_url FROM ${MODULES_TABLE} WHERE url = $1 AND cache_scope = $2 AND auth_user_id = $3`,
      {
        bind: [moduleUrl, cacheScope, authUserId],
        coerceTypes: modulesTableCoerceTypes,
      },
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
    return {
      definitions: row.definitions ?? {},
      deps: row.deps ?? [],
      error: row.error_doc ?? undefined,
      cacheScope: row.cache_scope,
      authUserId: row.auth_user_id || undefined,
      resolvedRealmURL: row.resolved_realm_url || '',
    };
  }

  private async writeToDatabaseCache(
    moduleUrl: string,
    definitions: Record<string, ModuleDefinitionResult | ErrorEntry>,
    deps: string[],
    errorDoc: ErrorEntry | undefined,
    resolvedRealmURL: string,
    cacheScope: CacheScope,
    authUserId: string,
  ): Promise<void> {
    await this.#dbAdapter.execute(
      `INSERT INTO ${MODULES_TABLE} (url, definitions, deps, error_doc, created_at, resolved_realm_url, cache_scope, auth_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (url, cache_scope, auth_user_id) DO UPDATE SET
         definitions = excluded.definitions,
         deps = excluded.deps,
         error_doc = excluded.error_doc,
         created_at = excluded.created_at,
         resolved_realm_url = excluded.resolved_realm_url`,
      {
        bind: [
          moduleUrl,
          JSON.stringify(definitions ?? {}),
          JSON.stringify(deps ?? []),
          errorDoc ? JSON.stringify(errorDoc) : null,
          Date.now(),
          resolvedRealmURL,
          cacheScope,
          authUserId,
        ],
      },
    );
  }

  private async populateCache(
    moduleUrl: string,
    realmURL: string,
    resolvedRealmURL: string,
    userId: string,
    cacheScope: CacheScope,
  ): Promise<ModuleCacheEntry | undefined> {
    let response = await this.getModuleDefinitionsViaPrerenderer(
      moduleUrl,
      realmURL,
      userId,
    );
    let cacheEntry: ModuleCacheEntry = {
      definitions: response.definitions ?? {},
      deps: response.deps ?? [],
      error: response.error,
      cacheScope,
      authUserId: cacheScope === 'public' ? undefined : userId,
      resolvedRealmURL,
    };
    await this.writeToDatabaseCache(
      moduleUrl,
      cacheEntry.definitions,
      cacheEntry.deps,
      cacheEntry.error,
      resolvedRealmURL,
      cacheScope,
      cacheScope === 'public' ? '' : userId,
    );
    return cacheEntry;
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

  async invalidate(realmURL: string): Promise<void> {
    await this.#inner.invalidate(realmURL);
  }

  registerRealm(realm: LocalRealm): void {
    this.#inner.registerRealm(realm);
  }

  forRealm(realm: LocalRealm): DefinitionLookup {
    return this.#inner.forRealm(realm);
  }
}
