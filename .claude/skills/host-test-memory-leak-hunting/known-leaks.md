# Known host-test memory leaks (catalog)

A running catalog of leaks found in the host test suite, the patterns that caused them, and the fixes. Read this before chasing a "new" leak — most rhyme with one of these.

Each entry is short on purpose. The fix code is in the linked commit; the *pattern* is what's worth recognizing.

---

## 1. `App._applicationInstances` Set retains destroyed instances

**Commit:** "Sweep destroyed ApplicationInstances from App._applicationInstances"
**Severity:** ~7.5 MB / test (dominant leak in the suite)

`ApplicationInstance.willDestroy()` calls `super.willDestroy()` THEN `this.application._unwatchInstance(this)`. When something in the super chain throws, `_unwatchInstance` is skipped — but `@glimmer/destroyable` still marks the instance as `isDestroyed`. The instance stays pinned in `App._applicationInstances` (a `Set`, not a `WeakSet`), retaining its Registry → template factories → FieldComponent closures → Box trees → ~7.5MB of base-realm module sources.

**Fix pattern:** sweep destroyed instances out of the Set in `QUnit.testDone`. Provably safe — only acts on instances already in the DESTROYED state per `@glimmer/destroyable`.

**Diagnostic:** `MEMPROBE` shows `app_instances=N alive=0 destroying=0 destroyed=N` with N climbing.

**Open follow-up:** find what's throwing in `super.willDestroy()` and file an upstream Ember issue. Likely a destructor in a boxel addon/card, but not yet identified.

---

## 2. `setupMockMatrix` leaked `testState` across tests

**Commit:** "Fix memory leak: clear testState in setupMockMatrix afterEach"
**Severity:** medium

`testState` was assigned in `beforeEach` but the previous test's `testState` reference (a closure-captured object holding rooms, events, members, the test's owner via service callbacks) was never released. Each test added to the retained-by-closure pile.

**Fix pattern:** explicitly null out the captured object in `afterEach`. Do not rely on the next `beforeEach` reassignment to release the prior value — the closure that referenced the prior value may outlive the test.

---

## 3. `globalThis.__loadCodeMirror` and friends — closure-over-owner

**Commit:** "Fix memory leaks: globalThis closures + capture-flag mismatch retain owners"
**Severity:** medium

Two flavors in one commit:

a. **`globalThis` lazy-load closures captured the test's `owner`.** Code like `globalThis.__loadFoo = () => owner.lookup('service:foo').load()` registers a function on the global that closes over `owner`. The next test reassigns the same global, but if any prior callsite kept a reference (a card `<template>` widget capturing it via `[](globalThis.__loadFoo)`), the prior owner is pinned.

b. **Listener `capture` flag mismatch.** `addEventListener('foo', cb, { capture: true })` requires `removeEventListener('foo', cb, { capture: true })`. Removing with `{ capture: false }` (or default) silently does nothing — the listener stays attached, the closure stays alive, the owner stays pinned.

**Fix pattern:** for globalThis closures, prefer service injection over global registration when called from card code; if global is necessary, store on `application` not `globalThis` so it dies with the App. For listeners, factor `addEventListener`/`removeEventListener` into matched pairs — same fn, same options object reference.

---

## 4. Resize handle modifier never unregistered listeners

**Commit:** "Fix memory leak: resize handle modifier never unregistered listeners"
**Severity:** small per modifier, but each test renders many

The `did-insert`/`will-destroy` modifier added a `mousemove`/`mouseup` listener to `document` but only removed it under specific code paths. Any test that destroyed the modifier without going through the cleanup path leaked the listener — and the listener's closure captured the modifier's `owner`.

**Fix pattern:** unregister in the modifier's destructor unconditionally. Use `registerDestructor(this, () => removeListener())` so removal happens even if user code didn't reach the "normal" cleanup path.

---

## 5. `StoreService.setup()` setInterval race — async setup, sync destroy

**Commit:** "Fix memory leak: guard setInterval after async setup() in StoreService"
**Severity:** ~20 MB / test (dominant leak when App._applicationInstances is already swept)

`StoreService.setup()` awaits `this.cardService.getAPI()`, then creates a `setInterval` timer that calls `this.store.sweep(api)`. The problem: Ember destroys services synchronously during test teardown. If `setup()` is still awaiting when `willDestroy` fires, the `await` resolves *after* the service is destroyed, creating an orphaned `setInterval` on a dead service. The timer closure captures `api` (the compiled card-api module proxy), which retains the entire base-realm module graph (~20 MB per test of `define("https://cardstack.com/base/...")` strings).

Additionally, `StoreService.cardApiCache` held a reference to the compiled card-api module, but `resetCache()` (called between tests) didn't clear it — so even without the timer, the prior test's module graph was retained until the *next* test's card-api compiled.

**Retainer chain:**
```
DOMTimer → closure → Context:api → JSProxy(card-api) → getComponent → _linksToEditor → module source strings
DOMTimer → closure → RenderStoreService.cardApiCache → get deserialize → _linksToEditor → module source strings
```

**Fix pattern:** After every `await` in a service's `setup()` or `init()`, check `isDestroyed(this) || isDestroying(this)` before creating timers, listeners, or any long-lived resources. Also clear cached references in `resetCache()` / `willDestroy()`.

```typescript
private async setup() {
  let api = await this.cardService.getAPI();
  if (isDestroyed(this) || isDestroying(this)) {
    return;                          // service died while we were awaiting
  }
  this.gcInterval = setInterval(...);
}
```

**Diagnostic:** `MEMPROBE` shows `used=` climbing ~20 MB/test even with `app_instances=0`. Retainer paths lead through `DOMTimer` to a compiled card-api module proxy. Use `snapshot-retainers.js --strong` to see the `DOMTimer` root.

---

## Patterns to look for when adding new code

These are not bugs — they're shapes of code that have repeatedly turned out to be leaks. Audit your PR for them:

- **Anything assigned to `globalThis.*` from inside a service or component.** That value will outlive every test owner. Either don't, or assign to `application` (which dies with the App), or use a `WeakRef`.
- **`document.addEventListener` from a modifier or component.** If the test doesn't tear it down via the normal route, the listener pins the owner. Pair every add with a destructor.
- **A `Set` or `Map` keyed by Ember objects.** If it's not a `WeakSet`/`WeakMap`, removal must be explicit and complete. If you need a Set keyed by an object, register a destructor that removes the entry on destruction.
- **A closure registered on a long-lived service or singleton that captures `this.owner`** (or anything reachable from owner). The closure pins the owner until the registration is undone.
- **A service that registers itself with another service in `init()`** but doesn't unregister in `willDestroy()`. The other service's registry holds a strong reference.
- **An `async setup()` or `init()` that creates timers/listeners after an `await`.** Ember destroys services synchronously during test teardown. If the `await` is still pending when `willDestroy` fires, the continuation runs on a dead service. Guard with `isDestroyed(this) || isDestroying(this)` after every `await` before creating any long-lived resource.
- **A service cache (`this.fooCache`) not cleared in `resetCache()` or `willDestroy()`.** Even if the cache is repopulated next test, the old value is retained until then — and if the old value is a large compiled module graph, that's tens of MB pinned.

When you ship one of these patterns, add a probe of `MEMPROBE` over the relevant test module before declaring done.
