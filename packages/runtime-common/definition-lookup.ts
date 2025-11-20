import type { DBAdapter, TypeCoercion } from './db';
import {
  fetchUserPermissions,
  type Definition,
  type ErrorEntry,
  type ModuleDefinitionResult,
  type ModuleRenderResponse,
  type Prerenderer,
  type ResolvedCodeRef,
} from './index';

const MODULES_TABLE = 'modules';
const modulesTableCoerceTypes: TypeCoercion = Object.freeze({
  definitions: 'JSON',
  deps: 'JSON',
  error_doc: 'JSON',
});

interface ModuleCacheEntry {
  definitions: Record<string, ModuleDefinitionResult | ErrorEntry>;
  deps: string[];
  error?: ErrorEntry;
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
}

export class CachingDefinitionLookup implements DefinitionLookup {
  #dbAdapter: DBAdapter;
  #prerenderer: Prerenderer;
  #realmOwnerLookup: RealmOwnerLookup;

  constructor(
    dbAdapter: DBAdapter,
    prerenderer: Prerenderer,
    realmOwnerLookup: RealmOwnerLookup,
  ) {
    this.#dbAdapter = dbAdapter;
    this.#prerenderer = prerenderer;
    this.#realmOwnerLookup = realmOwnerLookup;
  }

  async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
    let realmOwnerInfo = await this.#realmOwnerLookup.fromModule(
      codeRef.module,
    );
    if (!realmOwnerInfo) {
      throw new Error(
        `Could not determine realm owner for module URL: ${codeRef.module}`,
      );
    }
    let { realmURL, userId } = realmOwnerInfo;

    let moduleEntry =
      (await this.readFromDatabaseCache(codeRef.module)) ??
      (await this.populateCache(codeRef.module, realmURL, userId));

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

    let defOrError = moduleEntry.definitions[codeRef.name];
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
      `DELETE FROM ${MODULES_TABLE} WHERE realm_url = $1`,
      { bind: [realmURL] },
    );
  }

  private async getModuleDefinitionsViaPrerenderer(
    moduleUrl: string,
    realmURL: string,
    userId: string,
  ): Promise<ModuleRenderResponse> {
    let permissions = await fetchUserPermissions(this.#dbAdapter, { userId });
    return await this.#prerenderer.prerenderModule({
      realm: realmURL,
      url: moduleUrl,
      userId,
      permissions,
    });
  }

  private async readFromDatabaseCache(
    moduleUrl: string,
  ): Promise<ModuleCacheEntry | undefined> {
    let rows = (await this.#dbAdapter.execute(
      `SELECT definitions, deps, error_doc FROM ${MODULES_TABLE} WHERE url = $1`,
      { bind: [moduleUrl], coerceTypes: modulesTableCoerceTypes },
    )) as {
      definitions:
        | Record<string, ModuleDefinitionResult | ErrorEntry>
        | string
        | null;
      deps: string[] | string | null;
      error_doc: ErrorEntry | string | null;
    }[];

    if (!rows.length) {
      return undefined;
    }

    let row = rows[0];
    return {
      definitions: parseJSON<
        Record<string, ModuleDefinitionResult | ErrorEntry>
      >(row.definitions, {}),
      deps: parseJSON<string[]>(row.deps, []),
      error: parseJSON<ErrorEntry | undefined>(row.error_doc, undefined),
    };
  }

  private async writeToDatabaseCache(
    moduleUrl: string,
    definitions: Record<string, ModuleDefinitionResult | ErrorEntry>,
    deps: string[],
    errorDoc: ErrorEntry | undefined,
    realmUrl: string,
  ): Promise<void> {
    await this.#dbAdapter.execute(
      `INSERT INTO ${MODULES_TABLE} (url, definitions, deps, error_doc, created_at, realm_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (url) DO UPDATE SET
         definitions = excluded.definitions,
         deps = excluded.deps,
         error_doc = excluded.error_doc,
         created_at = excluded.created_at,
         realm_url = excluded.realm_url`,
      {
        bind: [
          moduleUrl,
          JSON.stringify(definitions ?? {}),
          JSON.stringify(deps ?? []),
          errorDoc ? JSON.stringify(errorDoc) : null,
          Date.now(),
          realmUrl,
        ],
      },
    );
  }

  private async populateCache(
    moduleUrl: string,
    realmURL: string,
    userId: string,
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
    };
    await this.writeToDatabaseCache(
      moduleUrl,
      cacheEntry.definitions,
      cacheEntry.deps,
      cacheEntry.error,
      realmURL,
    );
    return cacheEntry;
  }
}

export interface RealmOwnerLookup {
  fromModule(
    moduleURL: string,
  ): Promise<{ realmURL: string; userId: string } | null>;
}

function parseJSON<T>(value: unknown, fallback: T): T {
  if (value == null) {
    return fallback;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch (err) {
      console.warn('Failed to parse cached JSON value', err);
      return fallback;
    }
  }
  return value as T;
}
