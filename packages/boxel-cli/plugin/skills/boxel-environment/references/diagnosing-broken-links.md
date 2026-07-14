# Diagnosing Broken Links

When a `linksTo` or `linksToMany` target is broken (deleted or errored), Boxel renders a **broken-link placeholder** in place of the linked card. JavaScript access reads as `undefined` for a singular `linksTo`, and per-element for a `linksToMany` each broken (or not-yet-loaded) slot reads as `undefined` in place — the slot is preserved, not removed, so `arr.length` is unchanged. (Card authors must guard these reads — see [`defensive-link-traversal.md`](../../boxel/references/defensive-link-traversal.md).) The placeholder in the DOM is the **canonical signal** that something is wrong — not a transient loading state, not a missing field, not a bug to ignore.

The parent card carrying the broken link indexes cleanly. The error lives on the **linked instance**, not the parent. To diagnose, you follow the URL back to the linked instance.

## Recognise the placeholder

Every broken-link slot renders a `<div>` carrying these data-test attributes:

| Attribute | Value | Meaning |
| --- | --- | --- |
| `data-test-broken-link-template` | `isolated` \| `fitted` \| `embedded` \| `atom` | The render format of the broken slot |
| `data-test-broken-link-state` | `error` \| `not-found` | What kind of break |
| `data-test-broken-link-url` | full card URL | The URL of the broken target — **this is your starting point** |

Additional attributes you may see inside the placeholder, when applicable:

| Attribute | Available when |
| --- | --- |
| `data-test-broken-link-headline` | always |
| `data-test-broken-link-status` | the error doc carries a `status` or `title` |
| `data-test-broken-link-message` | `state === 'error'` only |
| `data-test-broken-link-stack` | `state === 'error'` and format is `isolated` |
| `data-test-broken-link-additional-error={i}` | `state === 'error'` and format is `isolated`, when upstream errors are chained |

The URL is also visible to human readers as the placeholder's primary text.

## `error` vs `not-found`

| `state` | What happened | How to fetch the diagnostic |
| --- | --- | --- |
| `not-found` | The linked instance doesn't exist (deleted or never created). | Realm GET on the URL returns a 404 error doc directly. |
| `error` | The linked instance exists but indexed with an error — broken `.gts` dependency, schema mismatch, computed threw, network failure during indexing, etc. | Fetch the linked URL; the error doc lives on **that** instance, not on the card you're editing. |

## Workflow

When the user asks to fix a broken link, or when you encounter a placeholder while reading a card:

1. **Extract the URL** from `data-test-broken-link-url` on the placeholder element.
2. **Fetch the linked instance** with `read-card-for-ai-assistant_xxxx` (cardId: the broken URL). The tool result surfaces the error message for both `error` and `not-found` states.
3. **Inspect linked source** if the error implicates a `.gts` dependency or schema mismatch. Use `read-file-for-ai-assistant_a831` with `fileUrl` set to the linked card's `.json` instance file or its `.gts` definition.
4. **Identify the root cause** — read `message`, `status`, `additionalErrors`, `stack`, and `diagnostics` on the error doc: deleted instance, broken `.gts` dependency, schema mismatch, transient network failure during indexing, etc.
5. **Propose a remediation**:
   - **Fix the linked card** itself — typical when `error` is from a broken computed or dependency in its `.gts` def.
   - **Re-target the link** on the parent to a different existing card. Use `patch-fields_3e67`.
   - **Remove the link** if the relationship is no longer needed. Use `patch-fields_3e67`.
   - **Restore the deleted instance** if `not-found` and recovery is possible.
6. **Verify post-fix**: the parent card's placeholder should disappear on the next render. If it persists, the underlying error wasn't addressed — re-diagnose; don't assume the fix worked.

## What the placeholder is *not*

- **Not a loading state.** Don't wait for it to resolve; act on it.
- **Not a "missing field" bug.** The parent's schema is fine; don't patch the parent's schema as a workaround.
- **Not transient.** A re-fetch won't make it disappear; the linked instance needs to be fixed.

## Pre-flight checklist

Before proposing a remediation, verify:
- [ ] Read the URL from `data-test-broken-link-url`?
- [ ] Fetched the linked instance and inspected its error doc?
- [ ] Targeting the right card — the linked one for `error` fixes, the parent's link field for re-targeting or removal?
