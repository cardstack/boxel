# Execution runtime minimality review

Maintainer-lens review of the execution-runtime core (working tree on
`codex/boxel-execution-runtime-architecture`), answering: assuming the
protocol and implementation are correct, is this the smallest, least
blast-radius, most framework-like implementation possible — and if not, what
takes it there?

## Verdict

**Mergeable with conditions.** The architecture is framework-shaped where it
matters: `ModuleEvaluator` is a clean injected seam on the existing Loader;
Capsule rendering rides public `setComponentManager` /
`createTemplateFactory` / `capabilities`; the tiers share one projection
pipeline and one record assembler; the total (~11.9k production lines
including runtime-common deltas) sits inside the architecture doc's
9,000–14,000 guardrail. What blocks a clean merge is shape, not size:

- a speculative module-invalidation chain (~110 lines) in shared
  `runtime-common/loader.ts` with zero consumers today (its consumer arrives
  with the HMR slice);
- ~400–500 lines of per-transport boilerplate (pending-request tables,
  hand-rolled envelope validators, error projectors) wanting one shared
  kernel;
- at least eight vocabularies spelled two or three times across
  classifier/evaluator/policy — the `networkBearingCSS` extraction proved the
  fix, its siblings were left behind;
- two unrelated riders (Percy/Vite alias; `isolated_html` query-engine
  projection) that belong in their own PRs.

Estimated net effect of the response plan: **−800 to −950 production lines,
no protocol or behavior change**, every inline vocabulary reduced to one
declared owner.

## Findings (ranked)

1. **F1 — dead speculative invalidation chain** (`Loader.invalidateModule` /
   `directModuleDependencies` in runtime-common, `CapsuleModuleEvaluator.
invalidateModule`, `BoxelExecutionService.invalidate`) — zero consumers;
   ~110 lines in the most-shared touched file. NOTE: the sandbox HMR slice
   (see boxel-sandbox-hmr-extraction.md) is this chain's consumer — either
   delete now and re-add with HMR, or land HMR first and keep it.
2. **F2 — empty subclass file** `capsule-runtime-registry.ts` (5 lines), plus
   `evictIdle`, `identityFor`, `BoxelRenderFormat` (all caller-less).
3. **F3 — four transports hand-roll one RPC kernel**: pending-request maps,
   timeouts, `failPending`/`destroy`/closed-flag, ~230 lines of structural
   validators spelling `'x' in value && typeof value.x === 'string'` chains,
   six copies of `asError`/`projectedError`. One `sandbox-port-rpc.ts`
   (PendingRequestTable + table-driven envelope guard + shared error
   projector): −250 to −350 lines.
4. **F4 — un-extracted vocabulary siblings** (each spelled ≥2 places):
   document-global at-rule list, top-layer attribute names, Glimmer wire
   opcodes, cssVar trusted identity, child format cascade, renderable-format
   list. One table per ownership boundary: −60 to −90 lines and closes every
   drift channel.
5. **F5 — trusted-import vocabulary exists three times**
   (`trusted-modules.ts`, evaluator's dead `defaultTrustedImport`, the facade
   install list). Make the option required; drive `installRuntimeFacades`
   from a 12-row spec table: −90 to −120 lines.
6. **F6 — module-evaluator machinery in a component file**:
   `rewriteDynamicImports` + `createSandboxModuleEvaluator` (~120 non-UI
   lines in `boxel-sandbox-runtime.gts`, define-shell duplicating the
   Loader's evaluator). Move to `lib/`; ideally the Loader's evaluator grows
   an extra-bindings/source-rewrite hook so the shell exists once.
7. **F7 — SafeEvent allowlists** live apart from their protocol type; move
   the `as const` arrays into `boxel-execution-protocol.ts` and derive the
   type.
8. **F8 — Capsule "Host-less fallback" projection** (~150 lines) is
   product-unreachable (the service always supplies a host projection).
   Author decision required: it may be intentionally retained as the RP-14.4
   "child re-derives" oracle.
9. **F9 — hand-rolled string/comment masking scanner** (56 lines) exists
   only as a perf prefilter before the authoritative Babel pass; a plain
   word-boundary regex gate costs at worst one extra parse.
10. **F10 — `MaterializationPurpose` is 60% unproduced** (only
    `host-display` / `interactive-edit` are ever created; nothing reads it).
    RESOLVED as protocol-reserved, keep: the frozen branch's CI collapse
    (one `could not identify card` indexing failure taking down 19/20 host
    shards) is empirical evidence the indexing-vs-interactive
    materialization split must be encoded before the Sandbox tier reaches
    the store — see
    [boxel-frozen-branch-parity-audit.md](boxel-frozen-branch-parity-audit.md)
    N6. Same family: `invokeCardMethod` (~60 lines, no product callers —
    the deferred BXL-command seam).
11. **F11 — duplicated pending-relationship predicate** in
    `boxel-projection.ts` (two spellings, one meaning).
12. **F12 — blast radius**: shared-file touches are individually defensible
    (router +3, loader-service +2, the boot-gate initializer, search-entries
    +1 arg, card-renderer switch). Two riders to split into their own PRs:
    the Percy/Vite alias and the `isolated_html` renderSet projection (a
    server query change with its own perf considerations). Naming: the tier
    adapters are `DirectBoxelRuntime`/`CapsuleBoxelRuntime`/
    `SandboxRuntimeProcess` — the third breaks the arch-doc pattern.

## Config-extraction shortlist

| Inline today                                                     | Proposed home                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| Document-global CSS at-rule list (classifier + 3 policy regexes) | export from `capsule-css-policy.ts`, like `networkBearingCSS` |
| Top-layer attribute names (regex string + Set)                   | same module, one array                                        |
| Glimmer wire opcodes (10; 14/24; 15/16/22/23)                    | one `glimmer-wire-opcodes.ts` const table                     |
| cssVar trusted identity (two predicates)                         | one exported predicate                                        |
| Trusted framework import vocabulary (three spellings)            | `trusted-modules.ts` + facade spec table                      |
| SafeEvent property allowlists                                    | `boxel-execution-protocol.ts` `as const` arrays               |
| Renderable-format literal list                                   | import runtime-common `formats`                               |
| Child default-format cascade (renderer + evaluator)              | one `childFormatCascade(format)` in the protocol module       |

## Response plan (ordered commits)

1. **S** Prune dead surface (F1 caveat: HMR is the consumer — sequence with
   the HMR slice), F2 family, purpose pruning. ~−230 lines.
2. **S** Split the two riders into their own PRs.
3. **M** Shared transport kernel (F3). ~−300 lines.
4. **M** Config-extraction commit (F4/F5/F7 tables). ~−80 lines, drift
   channels closed.
5. **M** Evaluator diet (facade table, dead fallback import predicate,
   `invokeCardMethod` behind the BXL seam, scanner removal). ~−250 lines.
6. **S** File hygiene (F6 move, F11 predicate, fold
   `boxel-execution-policy.ts` into the router, decide F8).
