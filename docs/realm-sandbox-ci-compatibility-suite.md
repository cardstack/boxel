# Realm sandbox CI compatibility suite

The staging compatibility Realm is a discovery tool: its forty cards expose
real combinations of syntax, data shape, presentation, interaction, and
browser authority. It should not become a forty-page screenshot test in CI.
Screenshots would be slow, brittle, and unable to explain whether a mismatch
came from card data, a delegated format, CSS, or the sandbox boundary.

CI instead tests the contracts those cards share against the in-process test
Realm. The test Realm requires no staging credentials, external network, AI,
or visual judgement. Assertions cover authored DOM, exact computed values,
interaction results, selected sandbox tier, renderer identity, protocol
messages, intrinsic size, and cleanup.

## Contract layers

| Contract                | Representative corpus cards                  | Automated proof                                                                                                                                     |
| ----------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opaque data and schema  | 1, 10, 11, 13, 16, 35                        | computed and inherited values materialize; Base fallback metadata stays inert                                                                       |
| Delegated FieldDefs     | 2, 3, 12, 14, 18, 31, 38, 39                 | singular, indexed, recursive, computed, and editable fields render authored DOM, never JSON                                                         |
| Delegated CardDefs      | 5, 6, 19 and all `FormatPreviewBatch*` cards | links and query-backed links render; one target crosses all seven CardDef formats                                                                   |
| Trusted Base portals    | 4, 8, 17, 19, 20, 22, 23, 26                 | trusted helpers/components are facades; Rich Markdown and themes preserve bounded data                                                              |
| SES interaction         | 7, 17, 21, 24, 29, 30, 31, 34-39             | allowlisted events, delegated `@set`, commands, media markup, and tracked state update without DOM authority                                        |
| CSS and presentation    | 1, 8, 11, 19, 20, 25, 27, 34, 38             | scoped styles and theme tokens stay local; unsafe/global CSS selects or is rejected by the correct boundary                                         |
| Iframe classification   | 9, 15, 27, 28, 32, 33, 40                    | document, Three.js, custom modifiers, top-layer markup, and unscoped styles select iframe deterministically                                         |
| Iframe protocol         | 9, 15, 28, 32, 33, 40                        | exact-origin one-use handshake, bounded fetch, readiness, type presentation, resize, and teardown are validated                                     |
| Live reload             | code-mode edits across every class           | a volatile generation adopts the existing SES island; acknowledgements do not remount; iframe publication is not mistaken for child acknowledgement |
| Lifetime and navigation | long-running cross-Realm use                 | departed compartments, styles, frames, ports, and settled loads are released                                                                        |

The new `CORPUS-*` acceptance tests are deliberately compositional:

- `CORPUS-01` is the delegated-format gauntlet that would have caught the
  blank `FormatPreviewBatchOne` page.
- `CORPUS-02` runs actual `RichMarkdownField` output containing the inert
  `-->` token that previously tripped the SES source transform.
- `CORPUS-03` combines inherited schema, `computeVia`, recursive
  `containsMany(FieldDef)`, and nested delegated render.

The lower-level sandbox tests remain responsible for failures that a second
browsing context cannot reliably exercise under Testem: source
classification, the MessageChannel handshake, response bounds, iframe height,
media transport, and child acknowledgement. This split is intentional. A
browser acceptance test proves that contracts compose in the Host; unit and
integration tests prove the security-sensitive boundary mechanics precisely.

## CI gates

The sandbox change is ready for broad Host CI only when these focused gates
pass first:

1. `Acceptance | code submode | sandbox live reload` (cold render, corpus
   composition, HMR, last-known-good, explicit reload).
2. `Integration | preview` (opaque Store materialization, trusted fallbacks,
   delegated fields, themes, stable format identity, runtime eviction).
3. `Integration | realm sandbox iframe` plus the iframe protocol/media unit
   modules.
4. `Unit | realm compartment module runtime` and source policy (schema,
   templates, commands, modifiers, CSS confinement, source cloning).
5. `Acceptance | realm sandbox navigation soak` (bounded cross-Realm
   lifetime).

The forty-card staging Realm remains a manual exploratory canary for new API
patterns. When it finds a new red cell, add the smallest failing contract to
this deterministic suite before fixing the implementation. That preserves the
sandbox capability without making CI depend on the staging service.
