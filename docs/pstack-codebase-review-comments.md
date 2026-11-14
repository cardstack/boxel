# Boxel pstack review comments

These are review comments on the load-bearing modules, not a second handoff. The four patches that should land first are in `docs/agent-handoff-permission-mint-and-related-fixes.md`. Everything below is the rest of the evidence.

Line numbers are from the tree this review was read against. If a hunk moved, search the symbol.

Severity:

- **Block.** Wrong today. Would bounce a PR.
- **Should.** Real cost. Fix when you next touch the file, or sooner if you own that area.
- **Note.** True, and not a reason to open a cleanup PR.

---

## `packages/runtime-common/realm-permission-checker.ts`

**Block.** `effectiveRealmPermissions` (lines 20–34) is the set `Realm#checkPermission` compares to `token.permissions`. The comment in this file already says mint must produce that union (`users` + `*` + username). `_realm-auth` does not. See `handle-realm-auth.ts`.

## `packages/runtime-common/db-queries/realm-permission-queries.ts`

**Block.** `fetchEffectiveRealmPermissions` (lines 138–158) is the mint helper. `fetchUserPermissions` (lines 161–245) is the realm enumerator. Its `UNION` adds `*` only when the user has no row for that realm, and it never reads `users`. Do not “fix” the enumerator by changing its return values. Mint sites must call the mint helper.

`run-command-request.ts` already documents this split next to a call site. Keep that split.

## `packages/realm-server/handlers/handle-realm-auth.ts`

**Block.** Lines 46–49 load `fetchUserPermissions`. Lines 169–178 sign `permissionsForAllRealms[realmUrl]` into the JWT. That is the username row, not the checkPermission union. A realm with `*`: `['read']` and user: `['write']` mints `['write']` and then 403s as `PermissionMismatch`.

Use `fetchEffectiveRealmPermissions` for the claim. Keep `fetchUserPermissions` for the URL list.

## `packages/realm-server/handlers/handle-create-user.ts`

**Block.** Line 42: `json.data.attributes.registrationToken` after a `JSON.parse` try. `{}` or a missing `data` throws. Auth is already past. This is a 500 for a bad client body. Parse the JSON-API shape or treat missing `data.attributes` as no token. Present non-string `registrationToken` is 400.

## `packages/runtime-common/ai/constants.ts`

**Block.** `SKILL_INSTRUCTIONS_MESSAGE` (lines 87–91) contains a literal `{skillInstructions}`. Nothing substitutes it. `getPromptParts` pushes this string, then appends skill bodies (`prompt.ts` 1640–1644). The model sees the braces. Delete the placeholder.

## `packages/bxl/src/jqtools/evaluate/compiledScalar.ts`

**Block.** `compileExcelIf` / `compileExcelIfs` (lines 80–127) are the live `IF` / `IFS` for any program that compiles wholly to scalars. The comments say the registry copies are dead for those programs, and that coverage cannot see this copy. There is no test that `prepareNativeJqForRuntime('IF(true,"yes","no")').compiledScalar` is a function. Registry cases that insert `ISBLANK` stay green if you break this path.

Add that test. Add a lockstep case against `evaluateBxl(..., { runtimeLimits: ... })` so both copies must agree. Include `IF(0,"a","b")` (jq truthiness: 0 is true).

**Should.** `SINGLE_OUTPUT_BARE_NATIVE_FILTERS` (top of this file) is a `Set` with no test that members yield once. A multi-output native added to the set truncates silently.

## `packages/bxl/src/jqtools/evaluate/filters/lib/nativeFilter.ts`

**Should.** `BareNativeFilter` vs `NativeFilter` is a property stamp (`bareNativeFilter`), not a tagged union (lines 5–18). The coverage recorder must re-wrap or every formula leaves the fast path and the suite still passes. Encode the handle-forward invariant as a test, not a comment.

## `packages/bxl/src/bxl/profiles/function-safety.ts`

**Should.** `classifyBxlProfileFunction` returns `unclassified` and the default is allow except on the predicate profile (around 487–506, 588–597). A new volatile builtin is legal in `derive` until someone remembers to add it to the denylist. Nothing diffs the lists against the registry.

## `packages/bxl/src/jqtools/evaluate/filters/registry.ts`

**Note.** `resolveRegistry` last-wins `Object.assign` and rebuilds `native['builtins/0']` (lines 52–72). That drop of library-level wrappers is load-bearing. The coverage runner already re-wraps. Leave it unless you are changing dispatch.

## `packages/bxl/src/jqtools/evaluate/utils/utils.ts`

**Note.** `Item<T=any>` and helpers typed as `any` are the jq value domain. Do not brand this in the same PR as the IF test. A BXL value ADT is a separate design.

## `packages/runtime-common/query.ts`

**Note.** `Query` (lines 37–45) is a real discriminated union: `realm` xor `realms`, `fields` only with `asData`. `assertQuery` (253+) is the wire parse. This is the discipline exemplar. Do not “improve” it.

**Should.** `Filter` (lines 71–80) is a structural union. Type guards (179–201) use `as`. `assertFilter` (473–513) allows `type` plus an operator. The compile IR in `expression.ts` is already `kind`-tagged. Do not change the wire. If you add a filter, add it to `assertFilter` and the engine in the same commit.

## `packages/runtime-common/resource-types.ts`

**Should.** `CardResource.attributes` is `Record<string, any>` (line 168). `Relationship.meta` is `Record<string, any>` (line 91). That is the user-schema tax. Illegal combinations (`sparseFields` + `error` + missing `adoptsFrom`) still compile. Shape checks live in `card-document-shape.ts`; field checks live later in `Field.validate` / `file-serializer`. A new consumer that trusts the type will eat garbage.

**Note.** `CardResourceMeta.sparseFields` vs absence is documented in-file (lines 99–104) and is a real invariant. Keep it.

## `packages/runtime-common/card-document-shape.ts`

**Should.** `isCardResource` checks `adoptsFrom` is a `CodeRef`, not the field schema (around 189–239). Fine as a first gate. The file-meta `adoptsFrom` check uses `&&` where the card check uses `||` (234 vs 285). Same outcome given the later `isCodeRef`, still sloppy. Make them match the next time this file moves.

## `packages/runtime-common/file-serializer.ts`

**Should.** Unknown and computed fields are dropped (190–192). Unresolvable `fieldOf` child defs pass through verbatim (152–159, 237–238). Schema drift is lossy, not loud. Missing **type** on write is loud (`realm.ts` 9286–9289). Decide whether unknown instance fields should 400. Today they vanish.

**Note.** This serializer exists so a write does not load a card module. Do not merge it with live `serializeCard` without a plan for that constraint.

## `packages/base/card-serialization.ts` and `packages/base/searchable.ts`

**Should.** Two serializers and two search-doc walks. Live `serializeCard` uses Field classes. Persist uses `Definition`. Live `BaseDef[queryableValue]` is sync and store-resident. `searchDocFromFields` is async, annotation-driven, and authoritative for the index (`searchable.ts` 37–41). `instance-filter-matcher` still uses the live walk. Drift between matcher and index is a real class of bugs. The parity tests are the guard. Do not delete one walk “to simplify” unless those tests still pin both.

## `packages/base/card-api.gts`

**Should.** This file is ~6017 lines: Field classes, Ember templates, CardDef, FileDef, deserialize. “What is a card?” is not answerable in 30 seconds. Extract only on a seam you already have (Field classes vs CardDef vs deserialize). Do not start a layering pass.

**Should.** `@field` factories return `as any` (2565, 2585) so `contains(StringField)` types as `string`. The lie is load-bearing for authors. Leave it. Do not spread that `as any` into new factories.

**Should.** `CardDef.id` is `contains(ReadOnlyField) as unknown as RealmResourceIdentifier` (3936–3938). `rri()` is also a thin `as` (`realm-identifiers.ts` 24–26). The brand is documentation, not a parse.

**Should.** `_updateFromSerialized` drops unknown field names (5281–5286). Same lossy contract as file-serializer.

**Should.** `LinksTo.getter` collapses `not-loaded`, `link-error`, `link-not-found`, and unset to `undefined` (1434–1453). Structured state is only `getRelationshipMembershipState` (`field-support.ts` 872). A card author who writes `if (!this.owner)` cannot tell “not fetched” from “no owner”. That is the public API. Changing it is a card-compat break. Document it next to the getter if you touch this.

**Should.** `serializeNonPresentLink` writes broken links as not-loaded (around 1348). Failure is transient. A permanent 404 looks like “try again”.

**Should.** `FileDef.serialize()` (3824) is a third, flat shape next to `serializeFileDef`. Name which callers need the flat one. If only one, inline it there.

**Note.** Number serializer invalid → `null` (`serializers/number.ts` 52–55), not a boundary error. Same lossy family.

**Note.** TODOs in-file: unused `Logger` (491), worker leftover (851), deserialize dual-duty (4935), `Field.validate` return value (5516). Delete dead ones when you are in the hunk. Do not sweep the file.

## `packages/host/app/services/store.ts`

**Should.** ~3938 lines. Get, peek, search, patch, delete, autosave, rebuild, prerender policy. `addReference` (621) is the load trigger. `get` (1017) is cache-first fetch. Easy to confuse with `CardResource` and `searchEntries`.

**Should.** The comment on `__dangerousCreateFromSerialized` (1999–2001) says `store.add()` swallows `Field.validate`. `add()` at 805–828 calls `createFromSerialized` with no such catch. The comment is wrong. Fix the comment. Do not change `add()` to match the comment.

**Note.** `cardFacingStore` Proxy is the right boundary. Cards cannot call `searchEntries`. Keep it.

## `packages/host/app/services/operator-mode-state-service.ts`

**Should.** ~1619 lines. Stacks, host trail, code path, AI panel, workspace chooser, expand map, profile modal, listing modal, file resource, realm-URL heuristics. `state` (272–289) is a shallow copy of `_state`. `profileSettingsOpen`, `expandedCardHeaderElement`, and `createListingModalPayload` are `@tracked` fields outside `OperatorModeState`. A reader cannot answer “where does expand live?” in 30 seconds.

**Should.** Expand is a `TrackedMap` by `instanceId`, serialized as `{ id, stackIndex }`. That domain is split from `StackItem`. The next expand bug will be a desync.

**Should.** `realmURL` (1243–1293) means a different realm per submode (open file vs right-most stack vs host primary vs cache vs default). `getWritableRealmURL` is another function. Name them in the UI layer so a tool does not write to the read heuristic.

**Should.** `findCardInStack` uses `(card as any)[localIdSymbol]` (534). The symbol exists so this cast is unnecessary if the type includes it.

**Note.** `setItemFormat` mutates in place so Glimmer does not remount (549–557, `stack-item.ts` 72–80). The unit test that asserts object identity is an implementation contract, and it is the right one. Do not “fix” the test to only assert the URL.

## `packages/host/app/services/host-mode-state-service.ts`

**Should.** Published-site stack and operator Host submode stack are two owners of the same `unwindOrPush` shape. A published-site bug can be fixed in the wrong service.

## `packages/host/app/templates/index.gts` and `packages/host/app/components/operator-mode/container.gts`

**Should.** `CardContext` is provided twice (index 172–188, container 167–184). Operator children see the inner one. Host mode sees only the outer. Copy-paste. One provider.

## `packages/host/app/routes/index.gts`

**Should.** The model hook (93–305) boots Matrix, billing, login-token switch, routing-rule redirects, `store.get`, and operator-state restore. `refreshModel: true` means this runs on every persist. The comment at 87–91 says keep it cheap. It is not cheap. Matrix boot and billing do not belong on the back-button path.

## `packages/host/app/components/card-renderer.gts`

**Should.** `Element: any` (line 30). Type the element.

**Note.** The 45-line facade is fine. Pixels come from `getBoxComponent` in `packages/base/field-component.gts`. That split is the card API, not host slop.

## `packages/runtime-common/formats.ts`

**Should.** `Format` includes `'form'` and `'metadata'` (1–10). `formats[]` omits them. Stack persist only allows `isolated|edit|head`. Three Format-like types. Delete the dead members or add them to the list and the persist allowlist in one change.

## `packages/host/app/lib/hydratable-card.gts` and published host mode

**Should.** Search hydration is correct: prerendered HTML, live on hover or store residency. Published isolated HTML is stripped and live-rendered (`index.gts` `removeIsolatedMarkup`, `HostModeCard`). Opposite laziness. The in-code TODO names the follow-up. Do not add a third path.

**Note.** `(globalThis as any).__boxelRenderContext` in store, hydratable-card, and card-prerender is a typed hole with a policy comment. A small `BoxelRenderGlobals` interface on `globalThis` is enough.

## `packages/host/app/services/client-telemetry.ts`

**Should.** Card-load settle is a heartbeat on `store.loadGeneration`. `card_id` is the rightmost top stack item (1048–1064), not the fetch that advanced the generation. A background search inflate attributes the open stack card. If the Grafana board is used for “this card was slow”, the id is a lie.

## `packages/host/app/services/tool-service.ts` and `matrix-service.ts`

**Should.** `readyTools: any[]`. Matrix event bindings `(...arg: any[])`. `matrix-service.ts` is ~3637 lines. UI components (`workspace.gts`, `add-workspace.gts`, profile settings) call Matrix through the service but own the orchestration. The HTTP edge is the service. The workflow is not.

## `packages/host/app/components/operator-mode/container.gts` (CSS)

**Should.** Operator mode overrides `--boxel-sp-xxl/lg/xs` globally and hardcodes `--operator-mode-bg-color: #686283` (243–248). boxel-ui tokens plus a raw hex plus card theme CSS is three systems. The next spacing bug will be “which token am I on?”

## `packages/runtime-common/realm.ts`

**Should.** ~9673 lines. Request router, authorizer, writer, serializer, searcher, file watcher, atomic ops. The mint bug is not fixed by splitting this file. If you extract, extract `checkPermission` + JWT verify as one module. That is the seam that already has a name.

**Should.** Bearer parsing is `authorizationString.replace('Bearer ', '')` (5212). Grafana uses `/^bearer\s+(.+)$/i` (`middleware/index.ts` 506). `retrieveTokenClaim` is the same `replace` (`utils/jwt.ts` 26). `bearer` lowercase fails realm auth and passes Grafana. One helper.

**Note.** Write lock is `pg_advisory_xact_lock` for replica serialization, not a transaction around FS + enqueue. Re-entry deadlocks. `/_atomic` uses `_batchWriteUnlocked` on purpose.

**Note.** `createRequestContext` for world-readable GET drops fetched rows and keeps `*` read plus realm-bot `assume-user` (9408–9418). Writes still get the full map. Easy to “fix” into a permission widening.

## `packages/realm-server/utils/jwt.ts`

**Should.** `retrieveTokenClaim` asserts `jwt.verify` as `RealmServerTokenClaim` (28–31). No claim-shape parse. `user` and `sessionRoom` missing still type-check. Parse after verify.

**Should.** `TokenClaims.delegated?` (`realm.ts` 908–919) is an optional flag on the same interface as a normal session. A delegated token is a different variant: `permissions: ['read']`, skip exact match, bind `token.realm === this.url`. A union would make the skip branch exhaustive.

## `packages/realm-server/middleware/index.ts`

**Should.** Search admission (260–266) treats `x-boxel-job-id` or the during-prerender header as indexing traffic and skips the wait. The comment says a forged header bypasses the wait, same trust as cache-only definition lookup. If those headers also unlock other prerender-only behavior, authenticate them. If they only skip a queue, document that as the trust boundary in one place, not only here.

## `packages/realm-server/middleware/multi-realm-authorization.ts`

**Note.** Parses the search body, stores it, handler reuses or re-parses, then `assertQuery`. Re-validating the query AST is correct. Do not remove `assertQuery` because auth already parsed JSON.

## `packages/runtime-common/index-query-engine.ts` and `index-writer.ts`

**Note.** Two-pass compile (`filterCondition` → `makeExpression` → `expressionToSql`) and `assertNever` on the IR are in good shape. Working vs production tables, incremental coalesce, HTML monotonic generation guard, `ignoreDataVersion` vs from-scratch: this is the concurrent-actor model. Do not “simplify” generation.

**Note.** Twin tables `boxel_index` / `boxel_index_working` must stay schema-identical. Additive and removal migrations already loop both. A column added to one is a production incident.

## `packages/runtime-common/ai/prompt.ts`

**Should.** ~2696 lines. Skills, tools, correctness, attachments, cache breakpoints, trailing context. First-wins tools and attachment-not-rewritten exist for prompt-cache byte stability (872–1004, 722–728). That constraint is real. Extract only along an existing function (`constructHistory`, `getTools`, `buildPromptForModel`). Do not add a prompt “framework”.

**Should.** Turn outcome is `shouldRespond: boolean` plus optional `pendingCodePatchCorrectnessChecks` (`types.ts` 19–28, `prompt.ts` 229–243). Silence reasons are lost. A small union (`AwaitTools` | `AwaitPatches` | `RunCorrectness` | `Generate`) would delete branches in `main.ts`.

## `packages/ai-bot/main.ts`

**Should.** Timeline handler ~640 lines (231–867): lock, billing, local-echo splice, stream, fulfill `readRealmFile` after releasing the lock. The lock dance is correct (fulfillment re-enters the handler). Comments are load-bearing. Extract fulfillment + splice, not “clean up” the order.

**Should.** Line 450 re-parses `event.getContent().data` without try or schema for `agentId`. History already parsed `data` and throws `HistoryConstructionError`. One parse.

## `packages/ai-bot/lib/read-realm-file.ts`

**Should.** `classifyToolCalls` (344–371) splits on `function.name === 'readRealmFile'` and returns two arrays of the same OpenAI type. That should be `BotRead | HostTool`.

**Note.** `ReadRealmFileResult` is already a proper ok/error union (87–95). Use that as the pattern.

## `packages/ai-bot/lib/matrix/response-publisher.ts` and `packages/runtime-common/commands.ts`

**Should.** Streamed tool JSON that fails `JSON.parse` becomes `{}` (`response-publisher.ts` 39–47; `decodeToolRequest` 222–234). Incomplete arguments persist into the room. Keep “not ready” until the stream completes. Empty args are a real tool invocation.

**Should.** Tool definitions from Matrix downloads are `JSON.parse(definitionContent).tool` (`prompt.ts` 955–959) with no schema. A bad skill file becomes a tool the model can call.

**Note.** `Command` / `Tool` dual names and the hash alias (`commands.ts` 133–188, 271–279) exist so stored hashes still match. Do not rename in this wave.

## `packages/ai-bot/lib/responder.ts`

**Should.** `deserializeToolCall` (345–355) has no callers. Delete it.

## `packages/ai-bot/lib/response-state.ts`

**Should.** `checkCorrectness` filter uses `(call as any)?.function?.name` (57–58). The OpenAI type already has `function.name`.

## `packages/runtime-common/helpers/ai.ts`

**Note.** `ToolChoice` is a real union (711–719). `PromptParts` is optional soup when `shouldRespond` is false. Fix with the turn ADT, not a new interface next to it.

## `packages/host` tests that pin implementation

**Note.** `operatorModeParametersMatch` parses `operatorModeState` JSON. Interact acceptance tests assert URL + DOM titles. `setItemFormat` unit tests assert object identity. Those are contracts, not slop. Tool tests that only assert `operatorModeStateService.state.submode` do not see the UI. Prefer the acceptance path when you add a test.

The full host suite cannot run locally. Do not try. Filter.

---

## What I would not comment

- Tagged `Filter` on the wire. Breaking, validated, IR already tagged.
- Making `rri()` a real parse in one wave. Migration, not a patch.
- Deleting dual serializers or dual search-doc walks.
- A “clean architecture” split of `realm.ts` or `card-api.gts`.
- Branding jq `Item` values.
- Promoting Adorn / overlays / SubmodeSwitcher into boxel-ui because host does not use Kanban. Cards use those components.

---

## Order if you implement from this list

1. Permission mint (`handle-realm-auth` + `fetchEffectiveRealmPermissions`).
2. BXL `compiledScalar` tests for `IF` / `ROUND` + lockstep.
3. `POST /_user` parse.
4. `{skillInstructions}` + dead `deserializeToolCall`.
5. Then, only when you are already in the file: stale `store.add` comment, Bearer helper, `Format` dead members, one `CardContext` provider, telemetry `card_id`, streamed tool `{}`, `classifyToolCalls` union.

Items 1–4 have a pasteable brief in `docs/agent-handoff-permission-mint-and-related-fixes.md`.
