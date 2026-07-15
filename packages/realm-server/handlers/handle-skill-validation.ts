import type Koa from 'koa';
import {
  IndexQueryEngine,
  RealmPaths,
  SupportedMimeType,
  fetchUserPermissions,
  logger,
  markdownDefRef,
  skillCardRef,
  systemInitiatedPriority,
  type IndexedFile,
  type ModuleRenderResponse,
  type Realm,
  type RealmPermissions,
} from '@cardstack/runtime-common';
import { ensureRealmOwnerPermissions } from '@cardstack/runtime-common/tasks/indexer';
import {
  sendResponseForBadRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import { isAuthorizedToViewMonitoring } from '../utils/monitoring.ts';
import { buildCreatePrerenderAuth } from '../prerender/auth.ts';

// Monitoring endpoint that validates every skill in a realm resolves. A skill
// is either a legacy `Skill` card (tool refs on `commands`) or a markdown file
// whose frontmatter declares `boxel.kind: skill` (tool refs on
// `frontmatter.tools`); both reference tool modules by codeRef, so a module
// rename breaks every skill pointing at the old path while API-level health
// checks stay green — the failure only surfaces when a browser tries to import
// the stale module. Each codeRef's module is therefore imported via the
// prerenderer (a real host in headless Chrome, with the same shims and virtual
// network a user's browser has), so a module this endpoint passes is one the
// deployed host can actually load.
//
// The validation sweep prerenders every distinct tool module, which costs
// seconds warm and tens of seconds on a cold prerender loader. To keep this
// usable as a frequent monitor, the per-realm result is cached and refreshed
// off the request path: a poll serves the last computed result immediately and,
// when that result is older than REFRESH_AFTER_MS, kicks a background refresh
// for the next poll. Only the first poll after a process start pays the sweep
// synchronously, so the response is always a definite pass/fail. The served
// result is therefore at most one refresh interval stale — `ageSeconds` on the
// response reports how old it is.

interface SkillToolFailure {
  skill: string;
  module: string;
  name: string;
  error: string;
}

interface SkillValidationAttributes {
  status: 'pass' | 'fail';
  skillsChecked: number;
  toolsChecked: number;
  failures: SkillToolFailure[];
}

interface ComputeDeps {
  dbAdapter: CreateRoutesArgs['dbAdapter'];
  definitionLookup: CreateRoutesArgs['definitionLookup'];
  virtualNetwork: CreateRoutesArgs['virtualNetwork'];
  prerenderer: NonNullable<CreateRoutesArgs['prerenderer']>;
  createPrerenderAuth: (
    userId: string,
    permissions: RealmPermissions,
  ) => string;
}

interface CachedValidation {
  computedAt: number;
  attributes: SkillValidationAttributes;
}

// Serve a cached result this fresh as-is; older than this, serve it but kick a
// background refresh. Kept below the monitor's cadence so each poll refreshes
// the previous poll's result off the request path.
const REFRESH_AFTER_MS = 4 * 60 * 1000;
const validationCache = new Map<string, CachedValidation>();
const refreshInFlight = new Map<string, Promise<CachedValidation>>();
const log = logger('realm:skill-validation');

// Recompute and cache one realm's result, deduping concurrent refreshes so a
// poll landing during an in-flight sweep joins it rather than starting another.
function refreshValidation(
  realm: Realm,
  deps: ComputeDeps,
): Promise<CachedValidation> {
  let existing = refreshInFlight.get(realm.url);
  if (existing) {
    return existing;
  }
  let pending = (async () => {
    try {
      let attributes = await computeValidation(realm, deps);
      let entry: CachedValidation = { computedAt: Date.now(), attributes };
      validationCache.set(realm.url, entry);
      return entry;
    } finally {
      // Clean up inside the promise body rather than via `pending.finally(...)`:
      // that would spawn a second promise which, on a refresh rejection,
      // rejects unobserved and surfaces as an unhandled rejection (the only
      // observed promise is `pending`, returned to the caller). Identity-check
      // so a newer in-flight entry installed after this one settled isn't
      // dropped.
      if (refreshInFlight.get(realm.url) === pending) {
        refreshInFlight.delete(realm.url);
      }
    }
  })();
  refreshInFlight.set(realm.url, pending);
  return pending;
}

export default function handleSkillValidation({
  dbAdapter,
  definitionLookup,
  prerenderer,
  realmSecretSeed,
  realmServerSecretSeed,
  reconciler,
  serverURL,
  virtualNetwork,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  let createPrerenderAuth = buildCreatePrerenderAuth(
    realmSecretSeed,
    serverURL,
  );
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    if (
      !(await isAuthorizedToViewMonitoring(ctxt.request, realmServerSecretSeed))
    ) {
      return setContextResponse(
        ctxt,
        new Response('Unauthorized', { status: 401 }),
      );
    }
    if (!prerenderer) {
      await sendResponseForSystemError(
        ctxt,
        'Prerenderer is not configured on this realm server',
      );
      return;
    }
    let realmPath = ctxt.URL.searchParams.get('realm')?.replace(/\/$/, '');
    if (!realmPath) {
      await sendResponseForBadRequest(
        ctxt,
        'Request missing "realm" query param',
      );
      return;
    }
    // Same resolution + registry gate as handle-reindex: `realm=` may be a
    // path relative to this server or an absolute URL, and only URLs present
    // in the realm registry mount, so this opens no SSRF surface.
    let realmURLObj: URL;
    try {
      realmURLObj = new RealmPaths(new URL(serverURL)).directoryURL(realmPath);
    } catch (e: any) {
      await sendResponseForBadRequest(
        ctxt,
        `invalid "realm" value: ${e.message}`,
      );
      return;
    }
    let realm: Realm | undefined;
    try {
      realm = await reconciler.lookupOrMount(realmURLObj.href);
    } catch (e: any) {
      await sendResponseForSystemError(ctxt, e.message);
      return;
    }
    if (!realm) {
      await sendResponseForBadRequest(
        ctxt,
        `realm ${realmURLObj.href} does not exist on this server`,
      );
      return;
    }

    let deps: ComputeDeps = {
      dbAdapter,
      definitionLookup,
      virtualNetwork,
      prerenderer,
      createPrerenderAuth,
    };

    // Serve the cached result. Only compute on the request path when nothing
    // is cached yet (the first poll after a process start) or the caller asks
    // for a fresh result with `refresh=true`; a stale-but-present result is
    // otherwise served immediately while a background refresh recomputes it for
    // the next poll.
    let forceRefresh = ctxt.URL.searchParams.get('refresh') === 'true';
    let cached = validationCache.get(realm.url);
    let entry: CachedValidation;
    if (forceRefresh || !cached) {
      try {
        entry = await refreshValidation(realm, deps);
      } catch (e: any) {
        await sendResponseForSystemError(
          ctxt,
          `unable to validate skills in realm ${realm.url}: ${e.message}`,
        );
        return;
      }
    } else {
      entry = cached;
      if (Date.now() - entry.computedAt > REFRESH_AFTER_MS) {
        // A failure here leaves the last good result in place (logged, not
        // surfaced) rather than blocking or failing the poll.
        refreshValidation(realm, deps).catch((e: any) => {
          log.error(
            `background skill-validation refresh for ${realm.url} failed: ${e.message}`,
          );
        });
      }
    }

    let ageSeconds = Math.round((Date.now() - entry.computedAt) / 1000);
    return setContextResponse(
      ctxt,
      new Response(
        JSON.stringify({
          data: {
            type: 'skill-validation',
            id: realm.url,
            attributes: { ...entry.attributes, ageSeconds },
          },
        }),
        {
          headers: { 'content-type': SupportedMimeType.JSONAPI },
        },
      ),
    );
  };
}

// Enumerate the realm's skills (legacy Skill cards + markdown skills) and
// validate every distinct tool module they reference. Throws on a search/DB
// failure; a returned result always carries a definite pass/fail status.
async function computeValidation(
  realm: Realm,
  deps: ComputeDeps,
): Promise<SkillValidationAttributes> {
  let {
    dbAdapter,
    definitionLookup,
    virtualNetwork,
    prerenderer,
    createPrerenderAuth,
  } = deps;
  let indexQueryEngine = new IndexQueryEngine(
    dbAdapter,
    definitionLookup,
    virtualNetwork,
  );

  let { cards } = await indexQueryEngine.searchCards(
    new URL(realm.url),
    { filter: { type: skillCardRef } },
    {},
  );
  // Discover markdown skills with a type-only file search, then narrow to
  // `kind: 'skill'` here. An `eq: { kind }` filter would make the query
  // resolve MarkdownDef's field definition; when that lookup misses, the
  // search engine swallows the resulting error into an empty result set,
  // silently dropping every markdown skill. A type match is definition-free —
  // it matches the indexed `types` column — so discovery stays reliable
  // regardless of which definitions are loaded here.
  let { files: markdownFiles } = await indexQueryEngine.searchFiles(
    new URL(realm.url),
    { filter: { type: markdownDefRef } },
    {},
  );
  let files = markdownFiles.filter(
    (file) =>
      (file.searchDoc?.kind ?? file.resource?.attributes?.kind) === 'skill',
  );
  let skills = [
    ...cards.map((card) => ({
      id: card.id!,
      tools: cardToolRefsFor(card),
    })),
    ...files.map((file) => ({
      id: file.canonicalURL,
      tools: markdownToolRefsFor(file),
    })),
  ];

  let failures = await validateToolModules({
    skills,
    realm,
    dbAdapter,
    prerenderer,
    createPrerenderAuth,
  });
  let toolCount = skills.reduce((sum, s) => sum + s.tools.length, 0);
  return {
    status: failures.length === 0 ? 'pass' : 'fail',
    skillsChecked: skills.length,
    toolsChecked: toolCount,
    failures,
  };
}

interface ToolRef {
  module: string;
  name: string;
}

// A legacy `Skill` card's tool refs live on its `commands` field — the
// field keeps its pre-rename name for serialized-instance compatibility.
function cardToolRefsFor(card: {
  id?: string;
  attributes?: Record<string, any>;
}): ToolRef[] {
  return refsFromToolFields(card.attributes?.commands ?? [], card.id);
}

// A markdown skill's tool refs live on the indexed `frontmatter.tools` field
// (the same `ToolField` shape as `Skill.commands`). Index rows extracted
// before the command → tool rename carry the value under `commands` instead;
// `tools` is a containsMany, so a pre-rename row yields [] (not undefined) —
// an empty-check routes to the fallback, mirroring the host's
// `getSkillSourceTools`.
function markdownToolRefsFor(file: IndexedFile): ToolRef[] {
  let frontmatter = file.resource?.attributes?.frontmatter as
    | { tools?: any[]; commands?: any[] }
    | undefined;
  let tools = frontmatter?.tools;
  return refsFromToolFields(
    tools?.length ? tools : (frontmatter?.commands ?? []),
    file.canonicalURL,
  );
}

function refsFromToolFields(
  tools: any[],
  sourceId: string | undefined,
): ToolRef[] {
  let refs: ToolRef[] = [];
  for (let tool of tools) {
    let codeRef = tool?.codeRef;
    if (!codeRef?.module || !codeRef?.name) {
      continue;
    }
    let module = codeRef.module as string;
    // AbsoluteCodeRefField serializes absolute refs (URL or registered
    // package form like @cardstack/boxel-host/...), but guard against
    // hand-authored relative refs anyway.
    if (module.startsWith('.') && sourceId) {
      module = new URL(module, sourceId).href;
    }
    refs.push({ module, name: codeRef.name });
  }
  return refs;
}

async function validateToolModules({
  skills,
  realm,
  dbAdapter,
  prerenderer,
  createPrerenderAuth,
}: {
  skills: { id: string; tools: ToolRef[] }[];
  realm: Realm;
  dbAdapter: CreateRoutesArgs['dbAdapter'];
  prerenderer: NonNullable<CreateRoutesArgs['prerenderer']>;
  createPrerenderAuth: (
    userId: string,
    permissions: RealmPermissions,
  ) => string;
}): Promise<SkillToolFailure[]> {
  let modules = new Set<string>();
  for (let skill of skills) {
    for (let tool of skill.tools) {
      modules.add(tool.module);
    }
  }
  if (modules.size === 0) {
    return [];
  }

  // Same auth recipe as the indexer's render path: permissions rows are
  // keyed by the full Matrix user id (not the bare username), and the owner
  // is guaranteed read access to the realm being validated even when the
  // permissions table has no row for it (e.g. bootstrap realms).
  let owner = await realm.getRealmOwnerUserId();
  let permissions = ensureRealmOwnerPermissions(
    await fetchUserPermissions(dbAdapter, { userId: owner }),
    realm.url,
  );
  let auth = createPrerenderAuth(owner, permissions);

  // One prerender per unique module; the prerender server's admission
  // control paces concurrent renders, and system priority keeps this
  // monitoring sweep from starving user-initiated work.
  let responses = new Map<string, ModuleRenderResponse>();
  await Promise.all(
    [...modules].map(async (module) => {
      responses.set(
        module,
        await prerenderer.prerenderModule({
          affinityType: 'realm',
          affinityValue: realm.url,
          realm: realm.url,
          url: module,
          auth,
          priority: systemInitiatedPriority,
        }),
      );
    }),
  );

  let failures: SkillToolFailure[] = [];
  for (let skill of skills) {
    for (let { module, name } of skill.tools) {
      let response = responses.get(module)!;
      if (response.status === 'error') {
        failures.push({
          skill: skill.id,
          module,
          name,
          error:
            response.error?.error?.message ?? `unable to load module ${module}`,
        });
      } else if (response.exports && !response.exports.includes(name)) {
        failures.push({
          skill: skill.id,
          module,
          name,
          error: `module ${module} has no export "${name}"`,
        });
      }
    }
  }
  return failures;
}
