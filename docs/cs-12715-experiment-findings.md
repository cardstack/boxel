# CS-12715 — experiment findings

Running the plan's verification protocol against the branch. Steps 1–6 below
are complete; steps 7–8 (live agent turns) follow.

Stack: the warm dev stack already running from the `cs-12715-spike` worktree
(realm-server 4201, host 4200). It only serves realms — the code under test is
the factory and parse gate run from `cs-12715-reuse`.

Active profile confirmed `@user:localhost` before any run. Not staging.

---

## Step 0 — corpus

The plan expects `Author` at **rank 1** for the `specType: card` + `matches:
"author"` query. Actual:

| rank | name     | module                                         |
| ---- | -------- | ---------------------------------------------- |
| 1    | BlogPost | `@cardstack/catalog/7af9aa-blog-app/blog-post` |
| 2    | Author   | `@cardstack/catalog/7af9aa-blog-app/author`    |

Two hits, `Author` second. Not a blocker — the reuse contract requires every
hit be dispositioned, so rank only affects which one the agent reads first —
but the plan's "expect: Author at rank 1" is not what this corpus returns.

The field modules the spike used are **not** under the blog-app directory:
`author.gts` imports them as `../fields/…`, so they serve from
`@cardstack/catalog/fields/contact-link/contact-link` and
`@cardstack/catalog/fields/featured-image/featured-image`, both `export
default`.

## Step 3 — source, not transpiled

Confirmed against the live realm, exactly the plan's numbers:

| request                               | bytes  | form                                             |
| ------------------------------------- | ------ | ------------------------------------------------ |
| plain `GET …/author.gts`              | 66,915 | transpiled — 18 `dt7948` lowered-decorator sites |
| `Accept: application/vnd.card+source` | 27,570 | the file on disk                                 |

## Steps 1–2 — the four shapes, against the live catalog

Driven through the real `runGlintCheck` with a real fetch (not the stub used
in the unit tests).

| shape                                             | result   |
| ------------------------------------------------- | -------- |
| A — extends catalog card, no template             | PASS     |
| B — extends catalog card, overriding `isolated`   | **FAIL** |
| C — base `CardDef` + catalog field, with template | PASS     |
| D — base `CardDef` + catalog field, no template   | PASS     |

B's error is **not** a resolution failure. It is:

```
Class static side 'typeof ContributorB' incorrectly extends
base class static side 'typeof Author'.
```

Getting a precise structural error rather than "cannot find module" is itself
the evidence that the resolver worked: the real `Author` type resolved.

### What actually blocks shape B

Varying one thing at a time:

| variant                                                            | result   |
| ------------------------------------------------------------------ | -------- |
| override `isolated` on catalog `Author`                            | FAIL     |
| override `fitted` only                                             | PASS     |
| add a field, override `isolated`                                   | FAIL     |
| add a field, no template                                           | PASS     |
| **local** parent, override `isolated`                              | PASS     |
| **local** parent whose `isolated` has an extra member, override it | **FAIL** |
| override `isolated` redeclaring the parent's extra member          | FAIL     |

`Author.isolated` declares `get themeStyle()` alongside its template. A
subclass overriding that static with a plain `Component<typeof this>` is not
assignable to it, and redeclaring the member does not help — `typeof this`
binds to a different class on each side.

**This is pre-existing and has nothing to do with catalog reuse.** The last
row reproduces it entirely inside one local file, with no catalog, no realm
prefix and no fetch. So:

- The plan's Step 2 table ("B: shim fail → real types pass") holds only for a
  parent whose template statics carry no extra members. For a parent like
  `Author` it does not, and no parse-gate change can make it.
- It is the same mechanism the spike named when it called `Author`
  `REUSE-BLOCKED` — "welded to `blog-defaults`' `themeStyleFor`". The spike's
  verdict was right; what is wrong is the expectation that fixing the parse
  gate would unblock this shape.
- Card-level adoption remains available: adopt and override `fitted`, or adopt
  and add fields without overriding the parent's decorated template. What is
  blocked is overriding a template the parent decorated.

The unit tests in `parse-realm-imports.test.ts` assert the shim/real-types
distinction against a stub parent with plain statics, which is the honest
version of the claim — it isolates what the resolver controls.

## Steps 4–6

- Interpolator: the plan's five cases pass, including the nested if-else case
  that previously rendered `AT{{#if y}}YB`.
- Delivery: `catalogSkills()` shows the real `catalog-reuse` description
  rather than `>-`; the resolver names it for implementation _and_ design
  issues; every named skill resolves; the system prompt renders the reuse
  block through both real backends, and fails when the flag is unwired.
- Suite: `pnpm test:node` 662 pass, 1 failure — the `port-allocator`
  dual-stack test, which fails while a dev stack holds ports. Baseline.
