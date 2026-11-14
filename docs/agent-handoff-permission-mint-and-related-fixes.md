# Agent handoff

Paste this entire file into a new agent as the task. Do not re-audit the repo. The four fixes below are the work. Ship them as small, independently verifiable commits.

## Goal

A per-realm session token's `permissions` claim must equal what `Realm#checkPermission` computes for that user. BXL's scalar fast path must be covered by a test that fails if production dispatch moves. `POST /_user` must reject a bad JSON body with 400, not throw. The skill system prompt must not contain a literal `{skillInstructions}` placeholder.

Definition of done: each fix has a test that would fail on `main` today, `pnpm lint` is clean in every package you touch, and you did not split `realm.ts`, `card-api.gts`, `store.ts`, or `prompt.ts`.

## Do not

- Rewrite `Filter` as a tagged union.
- Split or "clean up" `packages/runtime-common/realm.ts`, `packages/base/card-api.gts`, `packages/host/app/services/store.ts`, or `packages/runtime-common/ai/prompt.ts`.
- Change `fetchUserPermissions` return values as a blanket fix. That function enumerates realms. Callers that only need a realm list (federated-search auth, archive filters, catalog readability) must keep seeing the current keys. Mint sites need a different helper.
- Rewrite the BXL evaluator or delete the registry `def IF` / `def IFS`.
- Add comments that name tickets, PRs, or how you found the bug. State the live contract.

## Tooling

Repo root uses mise + pnpm. Typecheck with `glint`, never `tsc`. After edits, `pnpm lint` in each modified package. Do not commit `.only`.

## Fix 1. Mint the same permission union `checkPermission` enforces

### Contract

`effectiveRealmPermissions` (`packages/runtime-common/realm-permission-checker.ts`) is the set `Realm#checkPermission` compares to `token.permissions`. It is the union of:

- the realm's `users` row, if the Matrix account exists
- the realm's `*` row
- the username row

A mismatch is `PermissionMismatch`. Anything that mints a normal per-realm session JWT must mint that union.

`fetchEffectiveRealmPermissions` (`packages/runtime-common/db-queries/realm-permission-queries.ts`) already computes that set for one realm. Its docstring says it is the set to mint from.

`fetchUserPermissions` in the same file is the enumerator. Its `UNION` adds `*` only when the user has no row for that realm, and it never reads `users`. `packages/runtime-common/run-command-request.ts` already documents that limitation next to a call site. Leave the enumerator as the enumerator.

### What to change

1. In `packages/realm-server/handlers/handle-realm-auth.ts`, keep using `fetchUserPermissions` to decide **which** realm URLs get a token. For each URL you actually sign, set `permissions` from `fetchEffectiveRealmPermissions` (or `effectiveRealmPermissions` plus `fetchRealmPermissions` if you already have the map and a profile check). Do not pass `permissionsForAllRealms[realmUrl]` into `createJWT`.
2. Audit other mint sites that put `fetchUserPermissions` values into a JWT `permissions` claim that later hits `checkPermission` exact match. `_realm-auth` is the user-session mint. Prerender / indexer `createPrerenderAuth` may be a different token family. If those tokens skip the exact match, do not "fix" them. If they do not skip it, mint the union there too.
3. Do not change the SQL of `fetchUserPermissions` unless you add a **new** function and leave the enumerator tests in `packages/realm-server/tests/queries-test.ts` green without rewriting their meaning.

### Tests

Add a focused test, prefer `packages/realm-server/tests/queries-test.ts` or `packages/realm-server/tests/realm-auth-test.ts`.

Seed one realm with:

- `*`: `['read']`
- the user: `['write']`

Assert `fetchEffectiveRealmPermissions` (or the minted JWT claim) equals the union, including `read` and `write`. A second case with a `users` row plus a Matrix profile that exists must include that row.

If you add an HTTP test on `POST /_realm-auth`, decode the JWT and assert `permissions` is the union, not the bare username row.

Run:

```
cd packages/realm-server
TEST_FILES=queries-test,realm-auth-test pnpm test
```

Add `user-test` or the file you actually edited. Kill any leftover realm-server test process first.

Then `pnpm lint` in `packages/runtime-common` and `packages/realm-server` if both changed.

## Fix 2. Prove BXL's scalar route is the route under test

### Contract

`prepareNativeJqForRuntime` (`packages/bxl/src/bxl/bridge/native.ts`) stamps `compiledScalar` when the whole program compiles to scalars. `runParsedNativeProgram` uses that function when the caller did **not** pass `runtimeLimits`. Registry-enumerated coverage can stay green while that copy changes, because cases for `IF` / `IFS` insert `ISBLANK` and miss `compileExcelIf` (`packages/bxl/src/jqtools/evaluate/compiledScalar.ts`).

`IF` and `IFS` exist twice: `compileExcelIf` / `compileExcelIfs` on the scalar path, and `def IF` / `def IFS` in `packages/bxl/src/bxl/bridge/formula-contrib-jq.ts`. Both must agree.

### What to change

Add tests under `packages/bxl/tests/`. Follow the existing CLI style in `packages/bxl/tests/unit/function-dispatch-hardening-cli.ts` (or a sibling file the package already runs).

Required assertions, with literal inputs and literal outputs:

1. `prepareNativeJqForRuntime('IF(true,"yes","no")').compiledScalar` is a function. Call it and assert `'yes'`.
2. `prepareNativeJqForRuntime('ROUND(1.2345,2)').compiledScalar` is a function. Call it and assert the same number `evaluateBxl('ROUND(1.2345,2)', {})` returns.
3. Lockstep: the same `IF` / `IFS` programs through the scalar function and through `evaluateBxl` with an explicit `runtimeLimits` object (that forces the streaming / registry route) return the same values. Include `IF(0,"a","b")` so jq truthiness stays pinned (0 is true).

Do not assert the contents of `compiledScalar.ts`. Do not add `ISBLANK` to these cases. Export `prepareNativeJqForRuntime` from the package entry if the test cannot import the bridge specifier the package already exports.

Optional, only if cheap: a test that `function-safety` denylist / allowlist names exist in the registry. Skip a profile-system rewrite.

### Tests

```
cd packages/bxl
pnpm test
pnpm lint
```

## Fix 3. Parse `POST /_user` at the boundary

### Contract

`packages/realm-server/handlers/handle-create-user.ts` does `JSON.parse` in a try, then reads `json.data.attributes.registrationToken`. A valid JWT plus `{}` or a non-object `data` throws and becomes a 500.

`registrationToken` is optional for the create path. Missing token is not the same as a malformed document.

### What to change

After `JSON.parse`, require a JSON-API-shaped body if you need attributes, or treat a missing `data.attributes` as "no token". A present `registrationToken` that is not a string is 400. Never throw on `json.data` being absent.

Match the error helpers already used in that file (`sendResponseForBadRequest`).

### Tests

`packages/realm-server/tests/realm-endpoints/user-test.ts` already posts a well-formed body. Add a case with a valid JWT and `{}` or `{ data: {} }`. Expect 400 or 200 with no registration token, matching the contract you chose. Either is fine if it is explicit and does not 500.

```
cd packages/realm-server
TEST_FILES=realm-endpoints/user-test pnpm test
pnpm lint
```

If the server-level handler is the one mounted on `POST /_user` in `packages/realm-server/tests/server-endpoints/user-and-catalog-test.ts`, put the new case there instead.

## Fix 4. Remove the unused skill placeholder

### Contract

`SKILL_INSTRUCTIONS_MESSAGE` in `packages/runtime-common/ai/constants.ts` contains the literal `{skillInstructions}`. `getPromptParts` in `packages/runtime-common/ai/prompt.ts` pushes that string, then appends skill bodies via `skillCardsToMessages`. Nothing substitutes the placeholder. The model sees the braces.

### What to change

Delete `{skillInstructions}` from the constant. Keep the surrounding skill-instructions prose if it still earns its place, or fold it into one short paragraph. Do not add interpolation. Skill text already follows as separate system parts.

Update `packages/ai-bot/tests/prompt-construction-test.ts` assertions that include `SKILL_INSTRUCTIONS_MESSAGE`. They should still prove skill bodies appear, and that the placeholder string `{skillInstructions}` does not.

Optional subtract in the same commit: `Responder.deserializeToolCall` in `packages/ai-bot/lib/responder.ts` has no callers. Delete it if `pnpm test` in `packages/ai-bot` stays green. If anything imports it, leave it.

```
cd packages/ai-bot
pnpm test
pnpm lint
```

Also lint `packages/runtime-common` if you edited it.

## Commit and PR

Four commits, in this order:

1. Mint session tokens from `fetchEffectiveRealmPermissions`
2. Cover BXL scalar `IF` / `ROUND` dispatch
3. Parse `POST /_user` without throwing
4. Drop the `{skillInstructions}` placeholder

PR title (plain, no conventional-commit prefix): `Mint realm session permissions from the checkPermission union`

PR body, evergreen:

```markdown
## Background and Goal

A normal per-realm session JWT is accepted only when its `permissions` claim equals `effectiveRealmPermissions` for that user. `_realm-auth` currently signs the per-username enumeration from `fetchUserPermissions`, which omits `*` when the user has a row and never reads `users`. Shared-grant realms can then 403 a valid session as `PermissionMismatch`.

This also covers the BXL scalar route with tests that call `compiledScalar`, parses `POST /_user` so a missing `data` is not a 500, and removes the unsubstituted `{skillInstructions}` string from the skill system prompt.
```

Do not mention a review, a ticket, or a prior agent.

## Done when

- [ ] `_realm-auth` (and any other exact-match mint site) signs the `effectiveRealmPermissions` union
- [ ] A test fails if that mint regresses to the username row alone
- [ ] A BXL test fails if `IF(true,"yes","no")` no longer compiles to `compiledScalar`
- [ ] Scalar `IF` and registry `IF` agree on the lockstep cases
- [ ] `POST /_user` with a JWT and `{}` does not 500
- [ ] No `{skillInstructions}` in the built system prompt
- [ ] `pnpm lint` clean in every touched package
- [ ] No drive-by refactors
