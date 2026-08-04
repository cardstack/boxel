# Realm sandbox performance baseline

This document defines the performance and authority comparisons that must stay
truthful while the renderer evolves. A sandbox result is not a pass merely
because text eventually appears.

## Comparison lanes

Every representative card is measured in three lanes against the same realm
document and module revision:

1. trusted/native Host rendering (the current non-sandbox baseline);
2. SES compartment rendering;
3. cross-origin iframe rendering.

Record cold navigation, warm navigation, first authored DOM, interactive-ready,
format switch, edit-template open, first local source update, acknowledged
server update, retained DOM identity, module fetch count, and incremental heap
after repeated cross-realm navigation. Report medians and p95 rather than one
hand-timed run.

## Correctness gates before timing

- The selected authored format, styling, theme, `prefersWideFormat`, computed
  values, linked cards, and delegated fields match the trusted/native result.
- A writable realm remains writable. Edit templates, writable primitive
  fields, linked-card updates, and commands cross an explicit Host capability
  boundary and persist. A sandbox that silently renders a writable field as
  read-only is a compatibility failure.
- A read-only realm remains read-only and cannot gain write authority through
  a component, command, URL, iframe message, or Surface capability.
- Loading ends in authored content or an actionable error; an infinite spinner
  and a blank card are failures.
- Hosted preview uses the real nonce subdomain renderer. A localhost-only pass
  is recorded separately and cannot make the hosted column green.

### Read/write parity cases

Run these cases against the same card and principal in every supported render
lane. Do not record performance numbers for a lane until its authority result
matches native/trusted rendering.

| Operation                         | Writable realm expectation                                                                               | Read-only realm expectation                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Primitive field edit              | Local UI updates, the Host accepts the intent, the Store saves it, and a full reload shows the new value | UI is disabled or the Host rejects the intent; a forged sandbox message cannot change the Store |
| Default or authored edit template | The same controls are editable as native rendering                                                       | The same controls are read-only as native rendering                                             |
| Linked-card mutation              | The Host validates both owning and target card authority before persisting                               | The Host rejects the mutation even if the child can name the linked card                        |
| Command                           | The Host executes the command with the realm-scoped capability set and persists authorized effects       | The Host rejects effects that require write authority                                           |

An enabled control is not proof of writability. A write passes only after the
Host acknowledges persistence and a new document load reads the saved value.

## Initial observations (2026-08-04)

| Card                 | Local result before optimization | Initial observation                                                                                                               |
| -------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Scrabble Stream      | iframe pass                      | authored replay/board renders; cold graph is visibly slower than native                                                           |
| Tier Maker           | iframe pass                      | authored tier UI renders; cold graph is visibly slower than native                                                                |
| Assistant Run        | iframe pass                      | authored DOM appeared before the Host received `ready`; readiness was roughly 8 seconds cold                                      |
| Signet Proposal      | SES fail                         | header rendered but authored body stayed blank; classification/runtime compatibility bug                                          |
| Invoice Billing Form | render pass; write fail          | full delegated form rendered and controls were enabled, but the first live update stalled before Host persistence acknowledgement |

The first optimization target is therefore not a shorter loading message. It is
to publish `ready` once Glimmer commits authored DOM, continue non-blocking media
preparation afterward, deduplicate broker reads, and cache immutable trusted
modules across iframe instances without sharing realm authority.

## Metrics to add

- `sandbox.navigationStartToAuthoredDOM`
- `sandbox.navigationStartToReady`
- `sandbox.moduleRequests` and `sandbox.uniqueModuleRequests`
- `sandbox.moduleBytes`
- `sandbox.loaderCacheHits`
- `sandbox.formatSwitchToCommit`
- `sandbox.writeIntentToLocalCommit`
- `sandbox.writeIntentToHostReceipt`
- `sandbox.localCommitToRealmAck`
- `sandbox.realmAckToReloadedValue`
- `sandbox.renderRootRetained`
- active/cached SES runtimes and iframe documents by principal

Measurements must distinguish cold and warm runs. Base/catalog/Boxel UI modules
are immutable for a Host build and are candidates for shared compiled-source
caches; realm-authored modules and serialized card data remain partitioned by
the sandbox principal.
