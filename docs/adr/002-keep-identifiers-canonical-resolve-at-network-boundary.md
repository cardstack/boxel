---
status: proposed
date: 2026-04-16
recorded: 2026-10-15
retroactive: true
scope:
  - packages/runtime-common/**
  - packages/host/app/**
  - packages/base/**
  - packages/eslint-plugin-boxel/**
  - packages/realm-server/**
  - packages/ai-bot/**
  - packages/ai-assistant-evals/**
  - packages/bot-runner/**
  - packages/boxel-cli/**
  - packages/software-factory/**
  - packages/software-factory/.agents/**
  - packages/vscode-boxel-tools/**
  - packages/catalog/**
  - packages/*-realm/**
  - packages/pretui/**
  - packages/test-realm-cards/**
  - AGENTS.md
  - .claude/skills/**
---

# 002. Keep identifiers as canonical RRIs, and resolve them to URLs only at the network boundary

Card ids, module references, and links are Realm Resource Identifiers (RRIs):
branded strings in either prefix form (`@cardstack/base/card-api`) or URL form.
Inside the runtime they stay opaque and canonical. Only the VirtualNetwork turns
one into a URL, immediately before a network call. Well-known realms are named
by prefix, so card JSON and source mean the same thing in every environment.
The mechanics are in [Realm Resource Identifiers](../realm-resource-identifiers.md);
this ADR records the rules and why.

## 1. Decision

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when,
and only when, they appear in all capitals, as shown here.

### 1.1. Identifiers are opaque

Card ids, FileDef ids, module references, code-ref modules, and link targets
MUST be typed as `RealmResourceIdentifier` or `RealmIdentifier`. Code MUST
compare, key, store, and pass them as strings, without parsing them. Code MUST
test which form an identifier has only with the exported `isPrefixForm()`
helper.

A resource's realm is `meta.realmIdentifier`, a `RealmIdentifier`.
`meta.realmURL` is deprecated, and new code MUST NOT read it.

These are not identifiers:

- bare package specifiers, such as `@cardstack/boxel-ui/components`;
- fields whose documented value is a served URL, such as `Spec.moduleHref`.
  Such a field MUST say so in its name and type;
- index-row, realm-registry, and permission keys on the server, which are
  served URLs.

### 1.2. Resolution happens at the network boundary

Code MUST NOT pass an RRI to `new URL()`. Only VirtualNetwork methods MAY
convert an identifier from one form to the other. Code SHOULD resolve
immediately before the network call, and SHOULD pass the RRI to
`VirtualNetwork.fetch` directly. Realm membership and path math MUST use
`RealmPaths`. Code MUST join a relative reference with `resolveRRIReference`,
which keeps the form of its base.

Rendering and store code SHOULD NOT take a VirtualNetwork in order to resolve
an identifier. Code that already holds one, such as the realm write path, MUST
call its methods instead of resolving by hand. A store MAY call
`keyForIdentifier` to fold every spelling of a resource onto one internal key.
That key MUST NOT leave the store as an identifier.

A client without a VirtualNetwork MUST build one from the prefix map that the
realm server serves. It MUST NOT derive a URL from a prefix by naming
convention.

### 1.3. Canonical form at the edges

Serialization MUST write RRI form. Deserialization MUST canonicalize incoming
identifiers to RRI form. Identifiers in model prompts and Matrix events follow
the same rules. Realm-server endpoints that take an identifier MUST accept
prefix form.

### 1.4. Well-known realms are named by prefix

A well-known realm is one listed in `PREFIX_REALMS`. Source and card JSON,
including catalog content, MUST reference a well-known realm by its
`@cardstack/<realm>/` prefix, not by an environment-specific URL. Each prefix
MUST be registered on a VirtualNetwork instance with `addRealmMapping`.
`PREFIX_REALMS` MAY list the prefix names. The URL that a prefix stands for
MUST live only on a VirtualNetwork. Lint and migration tools MAY hold
prefix-to-URL tables, and these MUST derive from `PREFIX_REALMS`.

New code MUST NOT use the `https://cardstack.com/base/` alias. While the alias
is the base realm's registered identity, it MAY appear only in:

- `baseRealm`, the base realm's registration, and its permission rows;
- `registeredRealmURL` and tsconfig `paths` entries;
- code that recognizes legacy alias data, such as `equivalentURLForms`;
- tests of alias tolerance, canonicalization, or migration.

`no-url-form-base-imports` MUST allow the alias only in these positions.

## 2. Rationale

The rule against `new URL()` exists because the defect is invisible until it
fails. A branded string is assignable where a `string` is expected, so
`new URL(rri)` type-checks. A URL-form RRI parses. A prefix-form RRI throws
with no base, and with a base it resolves to a URL that points nowhere [1, 2].
The call site usually cannot know which form it holds [1]. The compiler cannot
see the difference, "which is why the same defect keeps recurring" [3], so a
type-aware lint rule enforces it [2, 3].

Prefix form makes card JSON and import specifiers portable. The catalog realm
is served at a different URL in development, staging, and production, but a
prefix-form link resolves in all three. Card JSON written in one environment
can be copied to another [1].

Resolving only at the network boundary has been a goal since the start of the
project [6]. Resolving at an in-memory site means "resolution is happening at
the wrong layer" [1]. Canonicalizing on deserialization keeps the rule true for
data that arrives from the network [1]. Agents found the discipline hard to
keep [6].

A realm is identified like any other resource, so its meta field is an RRI
[7]. A prefix id anchors relative links by path math, and Matrix room state
outlives any one environment's URLs [7]. `resolved*RealmURL` settings let a
realm be served anywhere, so a naming convention can resolve to the wrong place
without an error [7].

Store keys are the one place where the resolved URL is the right form.
`unresolveURL` leaves a URL-mapped alias unchanged, so only the real URL folds
every spelling of a resource onto one key [8].

## 3. Considered options

- **Canonical RRIs, resolved at the network boundary (chosen).**
- **Wrapper objects for identifiers.** A branded string matches the
  serialized form directly and uses less memory [6]. It is a compile-time
  marker with no runtime wrapper [1].
- **Address the base realm by `https://cardstack.com/base/…`, rewritten by the
  VirtualNetwork.** This was the earlier approach. It is "misleading — nothing
  is served there — and it required every consumer to know about the rewrite"
  [1]. The alias remains for realm data that still holds URL-form references
  [1].
- **Environment-specific realm URLs in source and card JSON.** These are not
  portable across environments [1, 4].
- **A global prefix registry.** The runtime replaced it with per-VirtualNetwork
  mappings [5], so that a test can register and drop a throwaway prefix without
  affecting other tests [1, 6]. More generally, the project avoids globals
  unless there is no other choice [6].
- **Allow a parse that a form check guards.** No guarded site needed to parse
  [7].
- **`meta.realmURL` as a served URL that code may parse** [7].
- **Key stores by the canonical identifier.** This adds a step on a hot path
  for a key that never leaves the store [7].
- **Absolute URLs for ids shown to the model**, so that it can follow relative
  links [7, 9].
- **Resolve prefixes by naming convention without a VirtualNetwork**, as
  boxel-cli does [1, 7].

## 4. Consequences

`no-url-from-realm-identifier` sees only branded values, so its coverage
depends on §1.1. A clean run does not show compliance with §1.2. The rule runs
only in `packages/runtime-common` and `packages/host` app code, which build the
TypeScript program it needs [3]. `no-url-form-base-imports` checks only import
specifiers, and `no-literal-realm-urls` checks only realm submissions [4].
Neither sees card JSON. Elsewhere, reviewers enforce §1.2 and §1.4.

## 5. Sources

1. `docs/realm-resource-identifiers.md`, added in #5720 (`be8e366834`), and
   its sections "Why prefix form", "Registering a prefix", "Resolution belongs
   at the network boundary", "RealmPaths", and "Compatibility with the
   base-realm alias".
2. `packages/eslint-plugin-boxel/lib/rules/no-url-from-realm-identifier.js`,
   header comment.
3. #5847 (`560dfa6853`), which added `no-url-from-realm-identifier` and
   enabled it in `packages/runtime-common/.eslintrc.cjs` and
   `packages/host/.eslintrc.js`.
4. #4202 (`3c9bde0da3`), which added `no-literal-realm-urls`.
5. #4954, which moved prefix mappings onto the VirtualNetwork. #4409 and
   #4425 introduced the identifier types and `addRealmMapping` as the first
   steps of the migration away from `https://cardstack.com/base/`. #5473
   (`d59e0635d4`) moved base code refs to prefix form and added
   `no-url-form-base-imports`.
6. Luke Melia, answering this ADR's open questions, 2026-10-15.
7. Luke Melia, deciding the findings of a compliance audit of this ADR,
   2026-10-19.
8. `VirtualNetwork.keyForIdentifier` in
   `packages/runtime-common/virtual-network.ts`, and the store-key comment in
   `packages/host/app/services/store.ts`.
9. `packages/host/app/lib/utils.ts`, comments on `skillsIndexId` and
   `skillFileURL`.

## 6. Remediation

- `packages/ai-assistant-evals/assistant-eval.spec.ts` and
  `packages/ai-assistant-evals/eval-card.ts` break §1.1 and §1.2. Joins links
  with `new URL()`, tests realm membership with `startsWith`, and filters skill
  ids by an `https?://` regex.
- `packages/ai-bot/lib/bot-tools/read-realm-file/read.ts` (`readRealmFileTool`,
  `ReadRealmFileArgs`, `fileLabelFromUrl`) breaks §1.1 and §1.2. Tells the model
  that file ids are full URLs, and parses one with `new URL()`.
- `packages/ai-bot/tests/prompt-construction-test.ts`,
  `packages/bot-runner/tests/bot-runner-test.ts`,
  `packages/boxel-cli/tests/commands/{file-read-cli,ingest-card-graph,ingest-card,search-query}.test.ts`,
  `packages/boxel-cli/tests/fixtures/parse/boxel-host-tools/saver.gts`,
  `packages/boxel-cli/tests/fixtures/parse/deliberate-type-error/broken.gts`,
  `packages/boxel-cli/tests/fixtures/parse/helpers-and-fields/event.gts`,
  `packages/boxel-cli/tests/fixtures/parse/runtime-common/home.gts`,
  `packages/boxel-cli/tests/integration/realm-ingest-card.test.ts`,
  `packages/realm-server/tests/fixtures/realistic/realm.json`,
  `packages/realm-server/tests/realm-endpoints/{archived-seal-test,readiness-check-test}.ts`,
  `packages/realm-server/tests/server-endpoints/{delegate-session-test,skill-validation-test}.ts`,
  `packages/realm-server/tests/{capture-task-test,card-endpoints-test,card-operations-core-test,card-operations-dispatch-test,declared-captures-file-test,indexing-test,queue-test}.ts`,
  `packages/runtime-common/tests/run-command-task-shared-tests.ts`,
  `packages/software-factory/test-fixtures/*/realm.json`,
  `packages/software-factory/tests/helpers/instantiate-test-fixtures.ts` and
  `packages/software-factory/tests/{catalog-reuse-delivery.test.ts,factory-seed.spec.ts,host-import-manifest.test.ts,instance-discovery.test.ts}`
  break §1.4. Tests and fixtures use the base alias, or env-specific URLs of
  well-known realms, as identifiers without testing alias tolerance.
- `packages/base/card-api.gts` (`CardStore`, `CardContext`, `QueryLoadMeta`,
  `SerializedFile`, `SerializedFileDef`) breaks §1.1, §1.2 and §1.3. Types store
  ids as `string`, parses a file id with `new URL()`, and leaves FileDef ids and
  `linksTo` targets uncanonicalized.
- `packages/base/realm-config.gts` (`httpURL`) breaks §1.1. Tests a policy
  pointer's form by parsing it with `new URL()`.
- `packages/base/matrix-event.gts` (`ToolDefinitionSchema`,
  `DiscoveredToolDefinition`, `BoxelContext`) breaks §1.1. Types code-ref
  modules and skill ids as `string`.
- `packages/base/workspace.gts`,
  `packages/experiments-realm/crm/{account,deal,task-planner}.gts`,
  `packages/experiments-realm/{blog-app,monetary-amount,product-catalog,review-blog,sprint-planner}.gts`,
  `packages/runtime-common/realm-identifiers.ts`,
  `packages/software-factory/.agents/skills-orchestrator/boxel-live-surfaces/SKILL.md`,
  `packages/software-factory/.agents/skills-orchestrator/boxel-live-surfaces/references/app-card-home-with-search.md`,
  `packages/software-factory/.agents/skills-orchestrator/boxel-runtime-surfaces/SKILL.md`,
  `packages/software-factory/realm/overview.gts` and
  `packages/software-factory/src/run-log.ts` break §1.3. `codeRef()` builds
  URL-form code refs with `new URL()`; these files define it, call it or teach
  it.
- `packages/bot-runner/lib/pr-listing/pr-listing-workflow-handler.ts`
  (`buildCreateContext`, `buildRetryContext`) breaks §1.2. Derives the
  submissions realm by naming convention, passing the event's realm to
  `new URL()`, which throws on a prefix-form realm.
- `packages/boxel-cli/plugin/skills/search/SKILL.md` breaks §1.1. Says a type
  filter needs the card's full module URL.
- `packages/boxel-cli/src/commands/capture.ts`,
  `packages/boxel-cli/src/commands/realm-server/render-token.ts`,
  `packages/boxel-cli/src/commands/realm/{indexing-errors,ingest-card}.ts` and
  `packages/boxel-cli/src/lib/boxel-cli-client.ts` break §1.1, §1.2 and §1.4.
  Types identifiers as `string`, parses card ids and links with `new URL()`,
  tests form by hand, or filters on the alias spec module.
- `packages/boxel-cli/src/commands/parse.ts` and
  `packages/runtime-common/{realm-source-cache,realm-source-staging}.ts` break
  §1.2 and §1.4. Maps prefixes to realm URLs by hand, assuming each prefix realm
  is served at `<origin>/<name>/`; `parse.ts` also restates the prefix list.
- `packages/boxel-cli/src/lib/resolve-realm-identifier.ts`
  (`isRealmResourceIdentifier`, `resolveRealmIdentifier`,
  `splitRealmResourceIdentifier`) breaks §1.1 and §1.2. Resolves an
  `@cardstack/<realm>/` prefix by naming convention against the server URL,
  after a hand `startsWith('@')` form test.
- `packages/catalog/scripts/sync-test-subset.ts` (`writeSubsetDir`) breaks §1.4.
  Writes the test-subset `realm.json` with an alias `adoptsFrom`.
- `packages/eslint-plugin-boxel/lib/rules/no-url-form-base-imports.js` and
  `packages/eslint-plugin-boxel/tests/lib/rules/no-url-form-base-imports-test.js`
  break §1.4. Accepts a `${baseRealm.url}…` template outside the positions where
  §1.4 allows the alias.
- `packages/eslint-plugin-boxel/lib/utils/import-utils.js` and
  `packages/realm-server/scripts/migrate-realms-to-rri.sh` break §1.4. Holds a
  prefix-to-alias table written by hand, not derived from `PREFIX_REALMS`.
- `packages/experiments-realm/BrandGuide/1fc32354-8201-4f79-b400-c7c94b507174.json`,
  `packages/experiments-realm/DetailedStyleReference/*.json`,
  `packages/experiments-realm/ProductCatalog/main.json`,
  `packages/experiments-realm/Spec/**/*.json`,
  `packages/experiments-realm/default/{5b09feb0-ed5f-4ee5-8836-36cbcb789a72,c9ac9b4a-762b-4e89-ab35-3938286e8bde,neo-brutalist,vintage-luxury}.json`
  and `packages/school-example-realm/*/realm.json` break §1.4. Card JSON names
  base modules by the `https://cardstack.com/base/` alias.
- `packages/experiments-realm/crm/{account,deal,task-planner,task}.gts`,
  `packages/experiments-realm/{bot-request-demo,sprint-planner,sprint-task,task,update-room-skills-example}.gts`,
  `packages/school-example-realm/school-code/school-portal.gts` and
  `packages/software-factory/realm/{instantiate-result,issue-tracker,wiki}.gts`
  break §1.2. Card source parses ids and code-ref modules with `new URL()`, or
  derives catalog and skills URLs by naming convention.
- `packages/host/app/components/ai-assistant/attached-file-dropdown-menu.gts`,
  `packages/host/app/components/ai-assistant/skill-menu/skill-toggle.gts`,
  `packages/host/app/components/card-chooser/modal.gts`,
  `packages/host/app/components/editor/recent-files.gts`,
  `packages/host/app/components/markdown-embed-chooser/pane.gts`,
  `packages/host/app/components/matrix/room.gts`,
  `packages/host/app/components/operator-mode/code-submode/playground/playground-panel.gts`,
  `packages/host/app/components/operator-mode/code-submode/{left-panel-toggle,module-inspector,spec-preview}.gts`,
  `packages/host/app/components/operator-mode/workspace-chooser/workspace.gts`,
  `packages/host/app/components/operator-mode/{card-schema-editor,code-submode,create-file-modal,create-listing-modal,edit-field-modal,interact-submode,publish-realm-modal}.gts`,
  `packages/host/app/components/realm-picker/index.gts`,
  `packages/host/app/components/search/{panel-content,section-header}.gts` and
  `packages/host/app/components/{card-pill,realm-url-tooltip}.gts` break §1.1
  and §1.2. Component args type ids as `string`, or components parse ids with
  `new URL()` and test membership by hand.
- `packages/host/app/components/matrix/room.gts`,
  `packages/host/app/components/operator-mode/create-file-modal.gts`,
  `packages/host/app/components/operator-mode/workspace-chooser/{index,manage-catalogs,workspace}.gts`,
  `packages/host/app/lib/utils.ts`,
  `packages/host/app/services/{matrix-service,realm-server,realm}.ts`,
  `packages/host/app/tools/{create-submission-workflow,generate-readme-spec,get-user-system-card,listing-action-build}.ts`
  and `packages/host/app/utils/file-extract-runner.ts` break §1.4. Writes or
  matches env-specific URLs of well-known realms, or the base alias, in ids,
  code refs and realm lists.
- `packages/host/app/lib/matrix-classes/message-builder.ts` and
  `packages/host/app/services/store.ts` break §1.3. Adopts invalidation and
  Matrix ids as card ids without canonicalizing them.
- `packages/host/app/lib/{card-instance-warnings,client-telemetry-labels,gc-card-store,realm-utils,stack-item,visual-capture,workspaces}.ts`,
  `packages/host/app/resources/{auto-attached-card,card-resource,directory,file-tree-from-index,file,inheritance-chain}.ts`,
  `packages/host/app/routes/{command-runner,render}.ts`,
  `packages/host/app/utils/search/{sections,types,url}.ts` and
  `packages/host/app/utils/{assert-module-in-realm,register-boxel-transition,render-error}.ts`
  break §1.1 and §1.2. Helpers type ids as `string`, parse them with
  `new URL()`, or test form and membership by hand.
- `packages/host/app/routes/render/meta.ts` (`model`) breaks §1.3. Serializes
  relationships from `toURL`-resolved ids instead of RRIs.
- `packages/host/app/services/{capabilities,card-service,card-type-service,host-mode-service,host-mode-state-service,local-persistence-service,matrix-sdk-loader,matrix-service,message-service,module-contents-service,monaco-service,operations,operator-mode-state-service,playground-panel-service,realm-info-service,realm-server,realm,recent-cards-service,recent-files-service,render-service,render-store,spec-panel-service,store}.ts`
  break §1.1 and §1.2. Public methods type ids as `string` or `URL`, parse ids
  with `new URL()`, or test form and membership by hand.
- `packages/host/app/tools/{create-submission-workflow,listing-action-build,migrate-skill,one-shot-llm-request,run-realm-code,show-card,sync-openrouter-models}.ts`
  break §1.1 and §1.2. Tools parse card, module and realm inputs with
  `new URL()`, or test form and membership by hand.
- `packages/realm-server/handlers/{handle-bot-commands,handle-capture,handle-diagnostic-render-token,handle-publish-realm,handle-reindex,handle-skill-validation,handle-webhook-commands,webhook-filter-handlers}.ts`
  break §1.1, §1.2 and §1.3. Types identifiers as `string`, parses them with
  `new URL()`, and refuses prefix-form ids.
- `packages/realm-server/prerender/auth.ts`,
  `packages/realm-server/scripts/load-harness/lib/derive-workload.ts` and
  `packages/realm-server/tests/load-links-batching-test.ts` break §1.2. Parses
  ids with `new URL()` or tests module membership by string prefix.
- `packages/realm-server/scripts/bench-realm/fixtures/realm-snapshot/Spec/sticky-note.json`,
  `packages/realm-server/scripts/bench-realm/fixtures/realm-snapshot/{index,realm}.json`,
  `packages/realm-server/scripts/bench-realm/fixtures/source-realm/realm.json`
  and `packages/realm-server/scripts/setup-submission-realm.sh` break §1.4.
  Seeds realm data with alias code refs.
- `packages/runtime-common/ai/{compaction,prompt}.ts`,
  `packages/runtime-common/card-operations/{client,coordinator,dispatch,policy}.ts`,
  `packages/runtime-common/index-runner/{dependency-normalization,index-backed-dependency-errors,prewarm-modules}.ts`
  and
  `packages/runtime-common/{bfm-card-references,catalog,command-parsing-utils,definition-lookup,paths,realm-index-query-engine,realm-index-updater,realm,run-command-request}.ts`
  break §1.2. Tests membership with `startsWith`/`slice`, parses ids with
  `new URL()`, or joins relative refs without `resolveRRIReference`.
- `packages/runtime-common/serializers/code-ref.ts` and
  `packages/runtime-common/{file-serializer,realm}.ts` break §1.3. Writes
  URL-form links and code refs to prefix realms instead of RRIs.
- `packages/runtime-common/index-runner.ts` breaks §1.4. Builds the canary
  module id from the `baseRealm.url` alias.
- `packages/runtime-common/{index,resource-types}.ts` break §1.1. Types resource
  ids, link targets and `Store` ids as `string`; resource meta has no
  `realmIdentifier`.
- `packages/software-factory/.agents/skills-orchestrator/boxel-live-surfaces/SKILL.md`,
  `packages/software-factory/.agents/skills-orchestrator/boxel-live-surfaces/references/app-card-home-with-search.md`,
  `packages/software-factory/.agents/skills-orchestrator/boxel-runtime-surfaces/SKILL.md`,
  `packages/software-factory/.agents/skills-orchestrator/boxel-runtime-surfaces/references/integration-surfaces.md`
  and
  `packages/software-factory/.agents/skills/software-factory-operations/SKILL.md`
  break §1.1. Skills tell agents that identifiers are absolute URLs, or to read
  `[realmURL]`.
- `packages/software-factory/assets/run-telemetry.gts.txt`,
  `packages/software-factory/docs/runbook.md`,
  `packages/software-factory/prompts/{issue-design,issue-implement}.md`,
  `packages/software-factory/realm/Wiki/adjust-mortgage-test.json` and
  `packages/software-factory/src/{factory-catalog-realm,run-log}.ts` break §1.4.
  Generates base imports with the alias, matches base types by the alias, or
  names the catalog by an env-specific URL.
- `packages/software-factory/src/factory-agent/{claude-code,opencode}.ts` and
  `packages/software-factory/src/{factory-catalog-realm,factory-tool-executor,instantiate-execution,issue-loop,issue-scheduler,parse-execution,realm-issue-relationship-loader,realm-operations,test-run-execution}.ts`
  break §1.1 and §1.2. Parses card ids and links with `new URL()`, does path
  math by hand, tests form with `startsWith('http')`, or derives the catalog URL
  by naming convention.
- `packages/test-realm-cards/**/*.gts`,
  `packages/test-realm-cards/contents/ModelConfiguration/*.json`,
  `packages/test-realm-cards/contents/SystemCard/default.json` and
  `packages/test-realm-cards/contents/{index,realm,skill-card-title-editing,skill-pirate-speak,skill-search-cards,skill-seo}.json`
  break §1.4. Fixture cards import and adopt from base by the alias.
- `packages/vscode-boxel-tools/src/skills.ts` (`SkillsProvider.refresh`) breaks
  §1.2 and §1.4. Hard-codes production URLs for base, catalog and skills, with
  no VirtualNetwork.
