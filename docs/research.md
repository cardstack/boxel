# Multi-Select Trigger + Options Research

## Goal
Design a reusable multi-select UI that matches the provided design:
- Trigger has two parts: label + selected items (customizable content like icon + text).
- Options list items contain checkbox + icon + text.
- Options are grouped into "selected" (top) and "unselected" (below), separated by a divider.
- Component is used in `search-sheet` and `card-catalog` modal, positioned immediately before the search input.

## Current codebase signals

### Existing multi-select base
- `packages/boxel-ui/addon/src/components/multi-select/index.gts` wraps `ember-power-select-multiple` and already supports:
  - custom `@triggerComponent`
  - custom `@selectedItemComponent`
  - custom `@beforeOptionsComponent` / `@afterOptionsComponent`
  - `@options`, `@selected`, `@onChange`
- This is the best place to build a reusable trigger and options layout while keeping power-select plumbing centralized.
 - Usage examples show **custom option rows via the yielded block**, e.g. in `packages/boxel-ui/addon/src/components/multi-select/usage.gts` the options are rendered with a custom “pill” component:
   - `AssigneePill` renders checkbox + icon + text + meta, and is invoked in the `BoxelMultiSelect` block: `as |option| <AssigneePill @option={{option}} ... />`
   - This matches our desired option-row layout (checkbox + icon + text), so we can follow the same pattern for realm options.
 - The labeled trigger + grouped options example now lives in `packages/boxel-ui/addon/src/components/multi-select/usage.gts`.

### Card catalog realm filter
- `packages/host/app/components/card-catalog/filters.gts` is currently a simple `BoxelDropdown` with a `Menu`.
- It already owns realm selection state via `@selectedRealmUrls` and selection handlers.
- The new multi-select can replace this filter UI while keeping the same selection logic.

### Search sheet
- `packages/host/app/components/search-sheet/index.gts` renders a `BoxelInput` and no realm picker yet.
- The new component can be inserted directly before the input, sharing realm data with card-catalog filters or realm service data.

## Where should the component live?

### Recommendation
Place the reusable UI in **Boxel UI** so it can be used by multiple host components:
- `packages/boxel-ui/addon/src/components/multi-select/trigger-labeled.gts` (or a more generic name)
- `packages/boxel-ui/addon/src/components/multi-select/grouped-options.gts`
- Re-export via `packages/boxel-ui/addon/src/components.ts`

Rationale:
- Both `search-sheet` and `card-catalog` are in host, but the behavior and visuals are generic multi-select patterns.
- Boxel UI already owns the base multi-select integration with ember-power-select.
- Keeping triggers and options in Boxel UI avoids duplication and makes future pickers (e.g., Type) easy.

Alternative (host-only):
- If this is intended to be specific to realm picking only, we could place a host-only wrapper component (e.g., `packages/host/app/components/realm-multi-select.gts`) that composes Boxel UI internals. But the visuals look generally useful, so default to Boxel UI.

## Proposed component structure

### 1) Trigger component (label + selected items)
**Purpose**: shows label on the left and a customizable selected-items area on the right.

**Suggested file**:
`packages/boxel-ui/addon/src/components/multi-select/trigger-labeled.gts`

**Args** (trigger):
- `@label`: string (e.g., "Realm")
- `@hasSelection`: boolean (for placeholder/empty state)
- `@placeholder`: string (optional; shown when no selection)
- `@selectedItems`: array (optional convenience)
- `@renderSelectedItem`: block (yields each item to render icon + text)
- `@disabled`: boolean
- `@isOpen`: boolean (to flip caret)

**Block usage**:
```gts
<BoxelMultiSelect
  @options={{this.realmOptions}}
  @selected={{this.selectedRealms}}
  @onChange={{this.onChange}}
  @triggerComponent={{component BoxelMultiSelectLabeledTrigger}}
  @selectedItemComponent={{component BoxelMultiSelectSelectedPill}}
  @placeholder="Select realms"
  @extra={{hash label="Realm"}}
>
  <:default as |option|>
    <RealmOptionRow @option={{option}} />
  </:default>
</BoxelMultiSelect>
```

Note: Power-select trigger components receive `@extra` (already supported). We can pass `label` via `@extra` or add a small wrapper that maps explicit args into `@extra`.

### 2) Grouped options list (selected first + divider)
**Purpose**: render selected options at the top, then a divider, then remaining options.

**Suggested file**:
`packages/boxel-ui/addon/src/components/multi-select/grouped-options.gts`

**Args**:
- `@options`: full list
- `@selected`: selected list
- `@isSelected`: function (or infer by identity)
- `@renderOption`: block or component for option row
- `@showDivider`: boolean (default true)

**Behavior**:
- Group selected options at the top.
- Divider appears only if both groups are non-empty.
- Unselected list follows.

This can be used inside the `BoxelMultiSelect` block to render `option` rows in the desired order.
We should explicitly implement this grouping for the realm picker; it is not provided by default in the current multi-select usage.

### 3) Option row (checkbox + icon + text)
**Purpose**: consistent row layout with checkbox + icon + label.

**Suggested file**:
`packages/boxel-ui/addon/src/components/multi-select/option-row.gts`

**Args**:
- `@iconURL`
- `@label`
- `@checked`
- `@disabled`

This can be host-specific if realm icon source is host-only; otherwise keep in Boxel UI.

## Suggested public API for host usage

### Host-level wrapper (optional)
Create a thin host wrapper to map realm info to the generic Boxel UI multi-select:

`packages/host/app/components/realm-multi-select.gts` (optional)
- Inputs:
  - `@availableRealms: Record<string, RealmInfo>`
  - `@selectedRealmUrls: string[]`
  - `@onSelectRealm(url)`
  - `@onDeselectRealm(url)`
  - `@disabled`
- Maps realm info to options with `{ id, name, iconURL }`
- Handles `@onChange` to call select/deselect
- Supplies trigger label ("Realm") and `selectedItemComponent` (icon + text)

### Minimal args for reusability
If we keep it purely in Boxel UI:

**Multi-select wrapper args**
- `@options: ItemT[]`
- `@selected: ItemT[]`
- `@onChange: (newSelection: ItemT[]) => void`
- `@label?: string` (via `@extra` or wrapper)
- `@placeholder?: string`
- `@renderSelectedItem?: ComponentLike`
- `@renderOptionRow?: ComponentLike`
- `@groupSelected?: boolean` (default true)

## How to make it reusable for card-catalog and search-sheet

### Shared realm picker
- Build a `RealmMultiSelect` host component that wraps the Boxel UI multi-select.
- Use it in:
  - `packages/host/app/components/card-catalog/filters.gts` (replace current dropdown)
  - `packages/host/app/components/search-sheet/index.gts` (add trigger before `BoxelInput`)
- Both locations already have access to realm data or can access realm services:
  - Card catalog already has `availableRealms` + selection handlers.
  - Search sheet can access `realmServer.availableRealmURLs` and `realm.info(url)` or reuse shared state from card catalog if available.

### State and selection
- Keep selection state owned by the parent (host):
  - `selectedRealmUrls` array
  - `onSelectRealm(url)` and `onDeselectRealm(url)`
- The multi-select receives `@selected` array and calls `@onChange`.
- In host wrapper, implement `@onChange` to diff arrays and call select/deselect.

### Placement
- Trigger sits inline with the search input; apply a compact size and rounded container to match the design.
- Use a layout container that wraps the trigger + input in one row (e.g., flex row).

## Open decisions / questions
- **Single vs multi-select**: design shows checkboxes and “Select All”. Confirm if multi-select is required in both contexts.
- **“Select All” row**: should it exist for all uses or only realm? If generic, add it as an optional pre-options row via `@beforeOptionsComponent`.
- **Search input inside options**: do we want `ember-power-select` search enabled or a custom search field in `beforeOptions` to match the design?
- **Icon source**: confirm if realm icons are always present or fallback to default icon.

## File touch list (expected)
- `packages/boxel-ui/addon/src/components/multi-select/trigger-labeled.gts` (new)
- `packages/boxel-ui/addon/src/components/multi-select/grouped-options.gts` (new)
- `packages/boxel-ui/addon/src/components/multi-select/option-row.gts` (new or host-specific)
- `packages/boxel-ui/addon/src/components.ts` (export)
- `packages/host/app/components/card-catalog/filters.gts` (replace dropdown with new multi-select)
- `packages/host/app/components/search-sheet/index.gts` (add trigger before search input)

---

## Comprehensive Implementation Research

### Component Architecture Deep Dive

#### How ember-power-select-multiple works
1. **Trigger Component**: Receives `@select` (Select object with `selected`, `isOpen`, `actions`, etc.) and `@placeholder`. Can access `@extra` for custom data.
2. **Selected Item Component**: Used inside the trigger to render each selected item. Receives `@option` and `@select`.
3. **Before Options Component**: Renders content before the options list. Receives `@select` and can access `@extra`.
4. **Options Block**: The default block yields each option from `@options` array. This is where we render the option rows.
5. **After Options Component**: Renders content after the options list. Receives `@select`.

#### Trigger Component Pattern
Looking at `packages/boxel-ui/addon/src/components/multi-select/trigger.gts`:
- Uses `BoxelTriggerWrapper` which provides consistent styling
- Has access to `@select.selected` (array of selected items)
- Can yield to `:default` and `:icon` blocks
- Receives `@selectedItemComponent` to render each selected item
- Can access `@extra` for custom data like label

**Key insight**: The trigger component receives `@select` which contains:
- `select.selected`: array of selected items
- `select.isOpen`: boolean
- `select.actions.select(newSelection)`: function to update selection
- `select.actions.open()` / `select.actions.close()`: functions to control dropdown

#### Selected Item Component Pattern
Looking at `packages/boxel-ui/addon/src/components/multi-select/selected-item.gts`:
- Receives `@option` (the selected item) and `@select`
- Uses `Pill` component for styling
- Has a remove button that calls `select.actions.remove(item)`
- Yields `@option` and `@select` to allow custom rendering

#### Before Options Component Pattern
Looking at `packages/host/app/components/operator-mode/code-submode/playground/instance-chooser-dropdown.gts`:
- Simple template-only component
- Receives `@select` and can access `@extra`
- Can render search input, "Select All" button, or any other UI
- Renders before the options list

#### Option Rendering Pattern
From `usage.gts`, options are rendered in the default block:
```gts
<BoxelMultiSelect ... as |option|>
  <AssigneePill @option={{option}} @isSelected={{includes this.selectedAssignees option}} />
</BoxelMultiSelect>
```
- Each option is yielded to the block
- Can check if option is selected using `includes(selected, option)`
- Custom components can render checkbox + icon + text

#### Icon Type
From `packages/boxel-ui/addon/src/icons/types.ts`:
- `Icon` is `ComponentLike<Signature>` where Signature has `Element: SVGElement`
- Icons can be passed as components (e.g., `IconSearch`) or as strings (URLs)
- For realm icons, we'll likely use string URLs from `realmInfo.iconURL`
- For type icons, might use Icon components or string URLs

### Detailed Implementation Strategy

#### 1) Labeled Trigger Component
**File**: `packages/boxel-ui/addon/src/components/multi-select/trigger-labeled.gts`

**Purpose**: Shows label on left, selected items (with optional icons) on right, caret on far right.

**Signature**:
```ts
interface TriggerLabeledSignature<ItemT> {
  Args: {
    placeholder?: string;
    select: Select;
    selectedItemComponent?: ComponentLike<SelectedItemSignature<ItemT>>;
    extra?: {
      label?: string;
      renderSelectedItem?: (item: ItemT) => ComponentLike | string | undefined; // For icon
      getItemText?: (item: ItemT) => string;
    };
  };
  Blocks: {
    default: [ItemT, Select];
  };
  Element: HTMLElement;
}
```

**Implementation notes**:
- Use `BoxelTriggerWrapper` for base styling (like `BoxelMultiSelectDefaultTrigger` does)
- Display `extra.label` on the left
- Show selected items using `selectedItemComponent` or default `BoxelSelectedItem`
- For each selected item, if `extra.renderSelectedItem` exists, use it to get icon
- Show caret in `:icon` block, rotate when `select.isOpen` is true
- Handle empty state: show placeholder when `select.selected.length === 0`

**Visual structure**:
```
[Label] [SelectedItem1] [SelectedItem2] ... [Caret]
```

#### 2) Grouped Options Rendering
**Challenge**: ember-power-select yields options one at a time in the default block, so we can't easily control the order.

**Chosen Approach: Option A - Pre-sort options array**

**Implementation**:
```ts
get sortedOptions() {
  const selected = this.args.options.filter(o => 
    this.args.selected.includes(o)
  );
  const unselected = this.args.options.filter(o => 
    !this.args.selected.includes(o)
  );
  return [...selected, ...unselected];
}
```

**Divider Logic**:
In the options block, show divider after the last selected item:
```gts
<BoxelMultiSelect @options={{this.sortedOptions}} ... as |option|>
  <OptionRow @option={{option}} @isSelected={{includes @selected option}} />
  {{#if (and 
    (includes @selected option)
    (eq option (last @selected))
    (gt (sub @options.length @selected.length) 0)
  )}}
    <Divider />
  {{/if}}
</BoxelMultiSelect>
```

**Notes**:
- Pre-sorting ensures selected items appear first
- Divider only shows if:
  1. Current option is selected
  2. Current option is the last selected item
  3. There are unselected items remaining
- This approach is simple and doesn't require filtering in the block

**Alternative approaches considered** (not chosen):
- **Option B**: Use beforeOptionsComponent for selected group (would duplicate rendering)
- **Option C**: Custom helper that yields grouped options (more complex, less flexible)

#### 3) Option Row Component
**File**: `packages/boxel-ui/addon/src/components/multi-select/option-row.gts`

**Purpose**: Consistent row with checkbox + optional icon + text.

**Signature**:
```ts
interface OptionRowSignature<ItemT> {
  Args: {
    option: ItemT;
    isSelected: boolean;
    getIcon?: (item: ItemT) => Icon | string | undefined;
    getLabel: (item: ItemT) => string;
    onToggle?: (item: ItemT, isSelected: boolean) => void;
  };
  Element: HTMLElement;
}
```

**Implementation**:
- Checkbox (checked when `isSelected`)
- Icon (if `getIcon` provided and returns value) - handle both Icon component and string URL
- Text label
- Click handler to toggle selection

#### 4) Before Options Component (Search + Select All)
**File**: `packages/boxel-ui/addon/src/components/multi-select/before-options-with-search.gts`

**Purpose**: Search input + "Select All" option.

**Signature**:
```ts
interface BeforeOptionsWithSearchSignature<ItemT> {
  Args: {
    select: Select;
    extra?: {
      searchPlaceholder?: string;
      showSelectAll?: boolean;
      getSelectAllLabel?: (count: number) => string;
      filterOptions?: (options: ItemT[], searchTerm: string) => ItemT[];
    };
  };
}
```

**Implementation**:
- Search input (controlled, filters options)
- "Select All (N)" option with checkbox
- When "Select All" clicked, select all filtered options
- Note: This requires managing filtered options state, which might conflict with ember-power-select's built-in search

**Alternative**: Use ember-power-select's `@searchEnabled` and `@searchField`, then add "Select All" as a special option or in beforeOptions.

#### 5) Reusable Picker Component
**File**: `packages/host/app/components/picker/index.gts` (or `packages/boxel-ui/addon/src/components/picker/index.gts`)

**Purpose**: High-level reusable picker that combines all pieces.

**Signature**:
```ts
interface PickerSignature<ItemT> {
  Args: {
    // Data
    options: ItemT[];
    selected: ItemT[];
    onChange: (selected: ItemT[]) => void;
    
    // Display
    label: string;
    placeholder?: string;
    
    // Item rendering
    getItemIcon?: (item: ItemT) => Icon | string | undefined;
    getItemText: (item: ItemT) => string;
    getItemId?: (item: ItemT) => string | number; // For comparison
    
    // Features
    searchEnabled?: boolean;
    searchPlaceholder?: string;
    showSelectAll?: boolean;
    groupSelected?: boolean; // Show selected items first
    
    // State
    disabled?: boolean;
  };
}
```

**Implementation**:
- Uses `BoxelMultiSelect` with `trigger-labeled`
- Uses `before-options-with-search` if search enabled
- Sorts options if `groupSelected` is true
- Uses `option-row` in default block
- Handles icon/text extraction via `getItemIcon`/`getItemText`

### Icon Handling Details

Icons can be `Icon` (component) or `string` (URL):
- For realms: `realmInfo.iconURL` (string)
- For types: might be Icon component or string URL
- In `option-row`, check type and render accordingly:
  ```gts
  {{#if (eq (type-of icon) "string")}}
    <img src={{icon}} alt="" />
  {{else}}
    <icon />
  {{/if}}
  ```

### Search Implementation Options

**Option 1: Use ember-power-select's built-in search**
- Set `@searchEnabled={{true}}` and `@searchField="name"`
- Simpler but less control over UI placement/styling
- Search appears at top of dropdown automatically

**Option 2: Custom search in beforeOptionsComponent**
- More control over UI
- Requires managing filtered state
- Need to filter options before passing to multi-select

**Recommendation**: Start with Option 1 (built-in search), customize if needed.

### "Select All" Implementation

- Add as first item in `beforeOptionsComponent`
- Checkbox state: checked if all visible options are selected
- Click handler: if all selected, deselect all; otherwise select all visible options
- Count shows number of visible options: `(count filteredOptions)`
- Note: "Select All" should only select currently visible/filtered options, not all options

### Updated File Touch List

#### Boxel UI (generic components)
- `packages/boxel-ui/addon/src/components/multi-select/trigger-labeled.gts` (new)
- `packages/boxel-ui/addon/src/components/multi-select/option-row.gts` (new)
- `packages/boxel-ui/addon/src/components/multi-select/before-options-with-search.gts` (new)
- `packages/boxel-ui/addon/src/components.ts` (export new components)

#### Host (domain-specific)
- `packages/host/app/components/realm-picker/index.gts` (new, wraps picker for realms)
- `packages/host/app/components/type-picker/index.gts` (new, wraps picker for types)
- `packages/host/app/components/card-catalog/filters.gts` (replace dropdown with realm-picker)
- `packages/host/app/components/search-sheet/index.gts` (add realm-picker before search input)

### Resolved Decisions

- **Single vs multi-select**: Design shows checkboxes and "Select All", confirming multi-select is required.
- **"Select All" row**: Should exist for all uses. Make it optional via `@showSelectAll` arg.
- **Search input**: Use ember-power-select's built-in search (`@searchEnabled`) initially, can customize later if needed.
- **Icon source**: Support both Icon components and string URLs. Realm icons are strings, type icons TBD.
- **Option grouping**: Pre-sort options array (recommended approach).
- **Component location**: Generic components in Boxel UI, domain-specific wrappers in host.

### Next Steps

1. Create `trigger-labeled.gts` in Boxel UI
2. Create `option-row.gts` in Boxel UI  
3. Create `before-options-with-search.gts` in Boxel UI
4. Create `realm-picker.gts` in host
5. Integrate into `card-catalog/filters.gts` and `search-sheet/index.gts`
6. Test with realm data
7. Create `type-picker.gts` following same pattern
