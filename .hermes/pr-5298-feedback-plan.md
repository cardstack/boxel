# PR #5298 Code Review Feedback — Implementation Plan

## Summary

Seven issues across three files. The root problem spans Issues 2–7: `selectedRealm` is initialized **synchronously** from `this.realm.allRealmsInfo`, but realm info loads **asynchronously** after component mount, so `selectedRealm` stays `undefined` permanently. The fix approach should be **unified** — introduce a reactive `effectiveRealm` getter or track the loading state — then fix Issue 1 (the double-fire on Enter) independently.

---

## Issue 1: `onSelect` fires twice on Enter (mini/index.gts ~line 126-129)

**Severity:** Bug  
**File:** `packages/host/app/components/file-chooser/mini/index.gts`  
**Root cause:** `IndexedFileTree.handleKeydown`'s `Enter` case (line 332-333) calls both `selectFile()` and `onFileConfirmed()`. In the MiniFileChooser, **both** `@onFileSelected` and `@onFileConfirmed` are wired to the same `handleFileSelected` action (lines 122-129), so the Enter key fires `@onSelect` twice.

**Fix:**

Change the `IndexedFileTree` template arguments in mini/index.gts (lines 122-129):

```gts
{{! OLD: both onFileSelected and onFileConfirmed wired to handleFileSelected }}
@onFileSelected={{fn this.handleFileSelected chooser.selectedRealm}}
@onFileConfirmed={{fn this.handleFileSelected chooser.selectedRealm}}

{{! NEW: onFileSelected calls a no-confirm handler, onFileConfirmed calls the real handler }}
@onFileSelected={{fn this.handleFileSelectOnly chooser.selectedRealm}}
@onFileConfirmed={{fn this.handleFileSelected chooser.selectedRealm}}
```

Add a new action that only updates `userSelectedFile` without calling `onSelect`:

```gts
@action
private handleFileSelectOnly(
  realm: FileChooserRealm | undefined,
  path: LocalPath,
) {
  if (!realm) {
    return;
  }
  this.userSelectedFile = path;
  // Deliberately does NOT call this.args.onSelect — that only happens on
  // confirmation (Enter) to avoid double-fire.
}
```

**Alternative simpler fix** (if IndexedFileTree's `onFileConfirmed` contract is considered an intentional "confirm" vs "select" distinction): Just change mini/index.gts to pass `undefined` for `onFileConfirmed`:

```gts
@onFileSelected={{fn this.handleFileSelected chooser.selectedRealm}}
@onFileConfirmed={{(fn (noop) undefined undefined)}}
```

But this loses the Enter → confirm semantics. The `handleFileSelectOnly` approach is cleaner: arrow-key navigation selects the visual highlight, Enter confirms.

**Test implication:** Update the "selecting a file fires onSelect" test to verify that pressing Enter still fires only once. Could use `await triggerKeyEvent(..., 'Enter')` and assert count === 1. The existing click-based test should continue passing unchanged.

---

## Issue 2–6 (unified): `selectedRealm` stays `undefined` after async realm loading

### Root cause analysis

In `panel.gts` lines 71-72:

```gts
@tracked private selectedRealm: FileChooserRealm | undefined =
  this.initialRealm;
```

The `initialRealm` getter (lines 87-93) calls `this.knownRealms`, which in turn accesses `this.realm.allRealmsInfo`. If realms haven't loaded yet (async), `allRealmsInfo` is empty, `knownRealms` is `[]`, `initialRealm` is `undefined`, and `selectedRealm` stays `undefined` forever because only `selectRealm` (the dropdown action) ever assigns to it.

**Unified fix approach:** Track the realm loading promise and reactively recompute `selectedRealm` when realms become available.

### Fix: panel.gts

Replace the static initializer with a reactive pattern. The cleanest approach for Ember/Glimmer is a `@tracked` property that gets set via a tracked task or a `trackedFunction` (ReactiveWeb), or a simpler `cached` getter that reads from a reactive source.

**Recommended approach — reactive getter + scheduler:**

```gts
@tracked private selectedRealm: FileChooserRealm | undefined = undefined;

constructor(owner: Owner, args: Signature['Args']) {
  super(owner, args);
  // Kick off realm-load tracking. When allRealmsInfo resolves, set selectedRealm.
  this.initializeSelectedRealm();
}

private async initializeSelectedRealm() {
  // Wait for realms to load (they may already be available)
  // realm.allRealmsInfo is reactive — when it changes, knownRealms will too.
  // We use a simple poll-on-tracked-change via Ember's scheduler.
  // But the simplest: use a tracked function that sets selectedRealm.

  // Actually, the simplest correct fix:
  // Mark selectedRealm as @tracked and provide a getter that falls back to
  // deriving from knownRealms when the tracked field is undefined.
}
```

**Simplest correct approach: make `selectedRealm` reactive via a getter**

Since `selectedRealm` was already `@tracked`, the problem is just that its initializer ran synchronously. The cleanest minimal fix: **don't initialize from `initialRealm` inline**. Instead, compute `selectedRealm` as a `@cached` getter backed by a `@tracked` selected URL, re-deriving from `knownRealms` reactively:

```gts
// Tracked internal URL (set by dropdown, or derived on mount)
@tracked private _selectedRealmURL: string | undefined;

get selectedRealm(): FileChooserRealm | undefined {
  if (this._selectedRealmURL) {
    return this.knownRealms.find(r => r.url.href === this._selectedRealmURL);
  }
  // Fall back to initial realm (re-evaluates reactively when knownRealms changes)
  return this.initialRealm;
}

// On mount, prime _selectedRealmURL from initialRealm via a reaction:
constructor(...) {
  super(...);
  // Use schedule('afterRender') or tracked function to set on first real data.
  // But actually knownRealms is already backed by @tracked allRealmsInfo,
  // so the getter re-evaluates whenever allRealmsInfo changes.
  // The only fix needed: don't snapshot at construction time.
}
```

**Minimum-change approach:** Change constructor initialization to never snapshot. Remove `= this.initialRealm` and instead make `selectedRealm` a **getter** that falls through to `initialRealm` reactively:

```gts
// Remove the tracked field entirely and replace with:
get selectedRealm(): FileChooserRealm | undefined {
  if (this._explicitlySelectedRealm) {
    return this._explicitlySelectedRealm;
  }
  return this.initialRealm; // recomputes when allRealmsInfo changes
}
@tracked private _explicitlySelectedRealm?: FileChooserRealm;
```

But this changes the code structure significantly. **Lowest-risk approach:**

Simply ensure the initializer is set asynchronously. Use a `@tracked` function or a constructor-side `next()` schedule:

```gts
@tracked private selectedRealm: FileChooserRealm | undefined;

constructor(owner: Owner, args: Signature['Args']) {
  super(owner, args);
  // Defer initialization — allRealmsInfo may not be ready yet.
  schedule('afterRender', () => {
    if (!this.selectedRealm) {
      this.selectedRealm = this.initialRealm;
    }
  });
}
```

**Wait — there's a simpler pattern used elsewhere in the codebase.** The `@tracked` field `selectedRealm` can be initialized to `undefined`, and then a `@cached` getter `effectiveRealm` can replace all consumer access points. But that means changing every reference from `selectedRealm` to `effectiveRealm`.

**Recommended minimal fix (panel.gts only):**

Add a constructor + `schedule` to set `selectedRealm` reactively. Then all consumers (issues 3-6) automatically work because the `@tracked` field update triggers re-render.

```gts
import { schedule } from '@ember/runloop';

@tracked private selectedRealm: FileChooserRealm | undefined;

constructor(owner: Owner, args: Signature['Args']) {
  super(owner, args);
  schedule('afterRender', this, 'refreshSelectedRealm');
}

@action private refreshSelectedRealm() {
  if (!this.selectedRealm) {
    this.selectedRealm = this.initialRealm;
  }
}
```

But this only runs once. To react when `allRealmsInfo` changes later, we need a tracked function or to observe `knownRealms` changes.

**Best approach: use `trackedFunction` (reactiveweb) like RealmDropdown does.**

Import and use:

```gts
import { trackedFunction } from 'reactiveweb/function';

selectedRealmTask = trackedFunction(this, async () => {
  return this.initialRealm; // re-runs when allRealmsInfo changes
});

// Then access via selectedRealmTask.value
```

But this changes the yield signature and all consumers.

**Finally — the most pragmatic fix for all of Issues 2-6:**

Change `selectedRealm` to a reactive property that defers to `initialRealm`, which is already a getter that reads from `knownRealms`. The only issue is that the `@tracked` annotation on `selectedRealm` tracks direct assignments, not reactive derivations. The fix:

1. Keep `@tracked private selectedRealm: FileChooserRealm | undefined` (now starts undefined)
2. At the top, add: `private _selectedRealmInitialized = false;`
3. In `selectRealm` action: set `_selectedRealmInitialized = true;`
4. Add a getter that is the **real** selectedRealm:

Actually, the cleanest way that preserves the entire public API:

```gts
// panel.gts — replace the tracked field + initializer with:
@tracked private _explicitlySelectedRealm?: FileChooserRealm;

private get selectedRealm(): FileChooserRealm | undefined {
  return this._explicitlySelectedRealm ?? this.initialRealm;
}

private set selectedRealm(value: FileChooserRealm | undefined) {
  this._explicitlySelectedRealm = value;
}
```

No other code changes needed because all assignments use `this.selectedRealm = ...`. The `@tracked` annotation is on the backing field, and the getter re-evaluates `initialRealm` reactively because `knownRealms` depends on `this.realm.allRealmsInfo` which is already tracked.

**But there's a subtlety:** `initialRealm` is a `get` (not `@cached`), so it already re-computes on every access. Since it reads from `knownRealms` which reads from `this.realm.allRealmsInfo` (tracked), the getter re-evaluates when realm info changes.

**Wait — the problem is actually simpler.** Looking again at the code:

```gts
@tracked private selectedRealm: FileChooserRealm | undefined = this.initialRealm;
```

The `= this.initialRealm` runs **once** at construction. `@tracked` doesn't re-evaluate initializers. So yes, the fix is to make `selectedRealm` a getter that picks up changes.

### Final recommended fix for panel.gts

```gts
// Lines 71-72 — replace:
@tracked private selectedRealm: FileChooserRealm | undefined =
  this.initialRealm;

// With:
@tracked private _explicitlySelectedRealm?: FileChooserRealm;

private get selectedRealm(): FileChooserRealm | undefined {
  return this._explicitlySelectedRealm ?? this.initialRealm;
}

private set selectedRealm(value: FileChooserRealm | undefined) {
  this._explicitlySelectedRealm = value;
}
```

This is a single-file change. All consumers (Issues 3-6) automatically get the reactive behavior:

- **Issue 3 (dropZoneLabel):** When `allRealmsInfo` loads, `initialRealm` → `this.initialRealm` → `this.knownRealms` is non-empty → `selectedRealm` becomes defined → `dropZoneLabel` renders the realm name.
- **Issue 4 (triggerUpload):** `selectedRealm` is now defined → early return on line 138-140 doesn't fire → upload proceeds.
- **Issue 5 (handleDrop):** Same — line 198 guard passes.
- **Issue 6 (consumers gate on selectedRealm):** The `{{#if chooser.selectedRealm}}` in mini/index.gts and modal.gts now re-renders when realms arrive.

---

## Issue 7: RealmDropdown shows "In undefined" (realm-dropdown.gts ~line 194)

**Severity:** Cosmetic  
**File:** `packages/host/app/components/realm-dropdown.gts`  
**Root cause:** `selectedRealm` getter (lines 186-208) returns `undefined` on initial mount when `allRealmsInfo` hasn't loaded. The template (line 58) checks `{{#if this.selectedRealm}}`, which correctly shows "Select a workspace" when undefined. But `selectedItemText` (lines 137-142) string-interpolates `this.selectedRealm?.name`, producing the literal text `"In undefined"` in the `title` attribute (line 55).

**Fix:**

In realm-dropdown.gts, the `title` attribute on the button already uses `this.selectedItemText`. The template already handles the `{{#if this.selectedRealm}}` branches. So the fix is in `selectedItemText`:

```gts
get selectedItemText() {
  if (!this.selectedRealm) {
    return '';
  }
  if (this.args.selectedRealmPrefix) {
    return `${this.args.selectedRealmPrefix} ${this.selectedRealm.name}`;
  }
  return this.selectedRealm.name;
}
```

Or make the `title` conditional: `title={{if this.selectedRealm this.selectedItemText ''}}`.

**Better: just guard `selectedItemText`.**

**Note:** This fix should also be applied defensively even after fixing Issues 2-6, because there's still a brief period before realms load where `selectedRealm` is undefined.

---

## Files to touch

| File                                                       | Issues    | Change                                                                                                    |
| ---------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| `packages/host/app/components/file-chooser/mini/index.gts` | 1         | Add `handleFileSelectOnly` action; unbind `onFileConfirmed` from `handleFileSelected`                     |
| `packages/host/app/components/file-chooser/panel.gts`      | 2,3,4,5,6 | Convert `selectedRealm` from tracked-field-with-snapshot to getter/setter over `_explicitlySelectedRealm` |
| `packages/host/app/components/realm-dropdown.gts`          | 7         | Guard `selectedItemText` against `undefined` selectedRealm                                                |

---

## Test implications

### panel-test.gts

- The existing test `opens on the initial realm` renders synchronously with `@initialRealmURL` and asserts `chooser.selectedRealm.info.name`. With the fix, this test **must continue to pass** because the realm service is fully indexed by the time the test reaches the assertion (hooks setup is async).
- **New test needed:** Verify that when realm info loads **after** mount (simulate by deferring `allRealmsInfo`), `selectedRealm` eventually resolves. This requires a realm service mock or controlling `allRealmsInfo` timing.

### mini-file-chooser-test.gts

- **No changes needed** for existing tests after Issue 1 fix (click-based selection tests are unchanged).
- **New test needed:** Press Enter on a file tree row; assert `onSelect` fires exactly once, not twice.
- **New test needed (optional):** Verify that arrow-key navigation does NOT fire `onSelect`.

### realm-dropdown.gts

- **No test changes needed.** The title/selectedItemText behavior is cosmetic and the dropdown template already guards with `{{#if this.selectedRealm}}`.

---

## Execution order

1. **panel.gts** (Issues 2-6) — the foundational fix; unblocks the other issues.
2. **realm-dropdown.gts** (Issue 7) — defensive guard, independent.
3. **mini/index.gts** (Issue 1) — the double-fire fix.
4. **Write tests** — verify the fixes.

---

## Open questions / risks

- **Does `initialRealm` actually re-evaluate reactively?** The `knownRealms` getter reads `this.realm.allRealmsInfo`, which is a tracked property on the realm service. As long as Glimmer's autotracking sees this access through the getter chain, yes. Confirm that `@service` properties are tracked in this version of Ember.
- **The `tracked` setter on `selectedRealm`** needs care: if we're using a getter/setter pair, we must ensure the setter triggers re-render. Using a `@tracked` backing field (`_explicitlySelectedRealm`) handles this.
- **Existing `selectRealm` action** (panel.gts line 121: `this.selectedRealm = realm`) continues to work because it goes through the setter.
