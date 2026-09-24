// Pretui — the menu tier: one `MenuNode` tree, two surfaces.
//
// `Menu` renders the tree IN PLACE, one level at a time, navigated by arrows.
// `CommandPalette` renders the SAME tree flattened and filtered, navigated by
// typing, with a breadcrumb when the reader descends into a nested scope. A
// command defined once therefore appears in both with one shortcut definition
// and one enabled rule — which is the whole reason they are one module, and
// why `SelectionMenu`/`ContextMenu` are this component with a different
// anchor rather than two more implementations.
//
// ── What the previous Menu was, and what changed ─────────────────────────
// The old `structure.gts` Menu took `(MenuItemSpec | '---')[]`, rendered
// `role='menu'` with `<button role='menuitem'>` children and closed via a
// backdrop <button>. Measured against a platform menu it had no submenus, no
// toggles, no radio groups, no mixed state, no section headers, no arrow
// keys, no Home/End, no type-ahead, no Escape-closes-one-level, no roving
// tabindex and no `aria-haspopup`/`aria-expanded` on the trigger. It was a
// click-only popover list — unusable by keyboard past Tab.
//
// Worse, it wrote `disabled={{item.disabled}}` on the button. A disabled
// button is REMOVED FROM THE FOCUS ORDER, so a dimmed item silently vanished
// for keyboard and screen-reader users while staying visible to everyone
// else — the exact failure Apple's "dim, don't remove" rule exists to
// prevent, reintroduced through markup. Every item here uses
// `aria-disabled='true'` and skips activation in the handler instead: the
// item stays focusable and announced, so the menu's shape is learnable by
// every reader. That rule belongs to every roving-focus collection in the
// kit, not just this one.
//
// `@items` and `@align` are unchanged and `MenuItemSpec` is now an alias of
// `CommandNode`, so every existing call site keeps working untouched.
//
// ── Deviations from Appendix N, with reasons ─────────────────────────────
// * **Markup is `<menu>`/`<li>`, not `<button>`.** `menuitemcheckbox` and
//   `menuitemradio` are children-presentational roles, and realm lint's
//   `require-presentational-children` rejects every descendant that is not a
//   span/div — including `<kbd>` and every component invocation. Rather than
//   ship two item markups, all four kinds share one, and the shortcut
//   renders as a styled span. `<kbd>` survives as the exported `Kbd` token
//   for prose and the palette footer. `<menu>` is HTML's own
//   list-of-commands element, so this is not a div soup: it is `<ul>`
//   semantics with the menu role layered on, which is what the APG asks for.
// * **The shortcut is `aria-hidden` and mirrored into `aria-keyshortcuts`.**
//   Letting "⌘B" fall into the accessible name is what most kits do and it
//   makes screen readers announce glyph soup. `aria-keyshortcuts` is the
//   property actually specified for this: the eye gets glyphs, assistive
//   tech gets `Meta+B`.
// * **`alt` is `Partial<MenuNodeBase>`**, not `Partial<MenuNode>` — a
//   partial of a discriminated union cannot express "same kind, different
//   label", which is the only thing dynamic items are for.
// * **`CommandPalette` is a combobox, not a menu button.** Appendix N names
//   the APG menu-button pattern as normative for both. That is right for
//   `Menu` and wrong for the palette, whose primary control is a text input
//   filtering a list — the combobox-with-listbox pattern
//   (`aria-activedescendant`, `role='option'`). Menu roles there would mean a
//   `role='menu'` whose focus lives in a textbox, which no screen reader
//   handles well.
// * **Point anchoring is not built.** `Menu` anchors to an ELEMENT, so a true
//   right-click context menu (anchored at pointer coordinates) needs a
//   virtual anchor `anchorTo` does not take. Named rather than half-shipped
//   (Law 7); `@anchorElement` already covers selection menus and toolbars.
//
// Timers: hover-intent, the safe-triangle grace and the type-ahead buffer all
// use `setTimeout` under the 2026-08-13 ownership ruling — every handle
// belongs to an `OwnedTimers` set that an `ember-modifier` adopts and
// releases. Nothing here calls `Date.now()` or `Math.random()`.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { guidFor } from '@ember/object/internals';
// type-only gap: 'ember-modifier' resolves at realm runtime; glint can't see
// it here (accepted parse baseline, same as overlay.gts / focus.gts)
import { modifier } from 'ember-modifier';
import { anchorTo } from './overlay';
import type { PopupPlacement } from './overlay';
import { iconFor } from './icon-registry';
import {
  OwnedTimers,
  PointerTrack,
  TypeaheadBuffer,
  focusWhen,
  listen,
  listenDocument,
  listenDocumentCapture,
  ownsTimers,
  rovingTabindex,
  safeEdgeFor,
  tracksPointer,
  typeaheadIndex,
} from './focus';
import type { SafeEdge } from './focus';

// ── The node taxonomy ────────────────────────────────────────────────────

/** Everything every kind of node carries. */
export interface MenuNodeBase {
  /** the item's text; the ellipsis comes from `needsInput`, never typed */
  label: string;
  /** shortcut spec — `'Mod+B'`, `'Shift+Alt+D'`, or a literal `'⌘B'`.
   * `Mod` is ⌘ on Apple platforms and Ctrl everywhere else, so one token
   * renders both: the platform mapping lives here, not in every caller. */
  kbd?: string;
  /** icon-registry name, drawn in the leading column of command items */
  icon?: string;
  /** secondary line — palette only, where there is room for it */
  description?: string;
  /** extra words the palette should match on (synonyms, ids) */
  keywords?: string;
  /** dimmed and inert, but still focusable and announced (HIG: dim, don't
   * remove — removing it changes the menu's shape between visits, so the
   * menu can never be learned) */
  disabled?: boolean;
  /** tinted destructive; put these below a separator, at the end */
  destructive?: boolean;
  /** the HIG default item: rendered bold */
  isDefault?: boolean;
  /** appends `…` (U+2026) — the HIG promise that more input is coming. An
   * ellipsis on a command that acts immediately is a lie about the click. */
  needsInput?: boolean;
  /** swapped in while Option/Alt is held (macOS dynamic menu items) */
  alt?: Partial<MenuNodeBase>;
  /** fired on activation */
  onSelect?: () => void;
}

export interface CommandNode extends MenuNodeBase {
  kind?: 'command';
}

export interface ToggleNode extends MenuNodeBase {
  kind: 'toggle';
  /** `'mixed'` renders a dash and announces `aria-checked='mixed'` — the
   * partial state a multi-selection produces (three of five are bold). This
   * is why `menuitemcheckbox` is the right role rather than a styled button,
   * and it is the piece every other kit skips. */
  checked?: boolean | 'mixed';
  /** receives the state the item would flip to */
  onChange?: (checked: boolean) => void;
}

export interface RadioNode extends MenuNodeBase {
  kind: 'radio';
  /** members of one group are mutually exclusive */
  group: string;
  checked?: boolean;
}

export interface SubmenuNode extends MenuNodeBase {
  kind: 'submenu';
  items: MenuEntry[];
}

export interface SectionNode {
  kind: 'section';
  /** the group's heading — also its accessible name */
  label: string;
  items: MenuEntry[];
}

export type MenuNode =
  | CommandNode
  | ToggleNode
  | RadioNode
  | SubmenuNode
  | SectionNode;

/** A menu's contents: nodes plus `'---'` separators. */
export type MenuEntry = MenuNode | '---';

/** The pre-rebuild name, kept so every existing call site still compiles. */
export type MenuItemSpec = CommandNode;

/** Every node that can occupy a focusable row — everything but a section. */
export type LeafNode = CommandNode | ToggleNode | RadioNode | SubmenuNode;

// ── Shortcut rendering ───────────────────────────────────────────────────

export type ShortcutPlatform = 'apple' | 'other';

const APPLE_GLYPH: Record<string, string> = {
  Meta: '⌘',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
};
const OTHER_WORD: Record<string, string> = {
  Meta: 'Win',
  Control: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
};
// Apple orders modifiers ⌃⌥⇧⌘; the rest of the world writes Ctrl+Alt+Shift.
const MOD_ORDER = ['Control', 'Alt', 'Shift', 'Meta'];
const MOD_ALIASES: Record<string, string> = {
  mod: 'Mod',
  cmd: 'Meta',
  command: 'Meta',
  meta: 'Meta',
  super: 'Meta',
  win: 'Meta',
  ctrl: 'Control',
  control: 'Control',
  alt: 'Alt',
  opt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
};
// Arrows read the same everywhere; the rest are Apple conventions.
const KEY_GLYPH_UNIVERSAL: Record<string, string> = {
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
};
const KEY_GLYPH_APPLE: Record<string, string> = {
  enter: '↩',
  return: '↩',
  backspace: '⌫',
  delete: '⌦',
  escape: '⎋',
  esc: '⎋',
  tab: '⇥',
  space: '␣',
  pageup: '⇞',
  pagedown: '⇟',
  home: '↖',
  end: '↘',
};

/** Reads the platform defensively: this module is evaluated by the indexer
 * too, where `navigator` may not be what a browser would give. */
export function detectShortcutPlatform(): ShortcutPlatform {
  if (typeof navigator === 'undefined') {
    return 'other';
  }
  let source =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ??
    navigator.platform ??
    navigator.userAgent ??
    '';
  return /mac|iphone|ipad|ipod/i.test(source) ? 'apple' : 'other';
}

export interface ParsedShortcut {
  mods: string[];
  key: string;
}

/** `'Mod+Shift+K'` → `{mods: ['Shift','Meta'], key: 'K'}`. Returns null for a
 * literal spelling (`'⌘K'`, `'F2'`), which is then passed through verbatim so
 * the pre-rebuild call sites that typed glyphs by hand keep rendering. */
export function parseShortcut(
  spec: string,
  platform: ShortcutPlatform,
): ParsedShortcut | null {
  let parts = spec
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  let mods: string[] = [];
  for (let part of parts.slice(0, -1)) {
    let resolved = MOD_ALIASES[part.toLowerCase()];
    if (!resolved) {
      return null;
    }
    if (resolved === 'Mod') {
      resolved = platform === 'apple' ? 'Meta' : 'Control';
    }
    if (!mods.includes(resolved)) {
      mods.push(resolved);
    }
  }
  mods.sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b));
  return { mods, key: parts[parts.length - 1] };
}

function keyFace(key: string, platform: ShortcutPlatform): string {
  let lower = key.toLowerCase();
  let universal = KEY_GLYPH_UNIVERSAL[lower];
  if (universal) {
    return universal;
  }
  if (platform === 'apple') {
    let glyph = KEY_GLYPH_APPLE[lower];
    if (glyph) {
      return glyph;
    }
  }
  if (lower === 'escape') {
    return 'Esc';
  }
  return key.length === 1 ? key.toUpperCase() : key;
}

/** The face of a shortcut: `⇧⌘K` on Apple platforms, `Ctrl+Shift+K` elsewhere. */
export function formatShortcut(
  spec: string | undefined,
  platform: ShortcutPlatform = detectShortcutPlatform(),
): string | undefined {
  if (!spec) {
    return undefined;
  }
  let parsed = parseShortcut(spec, platform);
  if (!parsed) {
    return keyFace(spec, platform);
  }
  let key = keyFace(parsed.key, platform);
  if (platform === 'apple') {
    return parsed.mods.map((mod) => APPLE_GLYPH[mod] ?? mod).join('') + key;
  }
  return [...parsed.mods.map((mod) => OTHER_WORD[mod] ?? mod), key].join('+');
}

/** The `aria-keyshortcuts` spelling — platform-neutral by specification, so
 * assistive tech announces "Command B" instead of reading a glyph. */
export function ariaKeyShortcuts(
  spec: string | undefined,
  platform: ShortcutPlatform = detectShortcutPlatform(),
): string | undefined {
  if (!spec) {
    return undefined;
  }
  let parsed = parseShortcut(spec, platform);
  if (!parsed) {
    return undefined;
  }
  return [...parsed.mods, parsed.key].join('+');
}

export interface KbdSignature {
  Args: {
    /** shortcut spec (`'Mod+K'`) or a literal face */
    value: string;
    /** force a platform instead of detecting it — the docs pages use this to
     * show both spellings side by side */
    platform?: ShortcutPlatform;
  };
  Element: HTMLElement;
}

/**
 * The shortcut token. One `kbd` spec renders the Apple glyph run and the
 * Ctrl/Alt/Shift spelling, so no caller ever hard-codes a platform.
 */
export class Kbd extends Component<KbdSignature> {
  get face(): string | undefined {
    return formatShortcut(this.args.value, this.args.platform);
  }
  get spoken(): string | undefined {
    return ariaKeyShortcuts(this.args.value, this.args.platform);
  }
  <template>
    <kbd
      class='pretui-kbd'
      aria-label={{this.spoken}}
      data-test-pretui-kbd
      ...attributes
    >{{this.face}}</kbd>
    <style scoped>
      .pretui-kbd {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 1.5em;
        padding-block: 1px;
        padding-inline: 5px;
        border-radius: var(--radius-chip, 4px);
        background: var(--pretui-kbd-background, var(--inset, var(--boxel-100)));
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
        color: var(--pretui-kbd-foreground, var(--muted-foreground));
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-variant-numeric: tabular-nums;
        line-height: 1.5;
        white-space: nowrap;
      }
    </style>
  </template>
}

// ── Row model ────────────────────────────────────────────────────────────

const ELLIPSIS = '…';

export type CheckState = 'on' | 'off' | 'mixed' | 'none';

function checkStateOf(node: LeafNode): CheckState {
  let kind = node.kind ?? 'command';
  if (kind !== 'toggle' && kind !== 'radio') {
    return 'none';
  }
  let value =
    kind === 'toggle' ? (node as ToggleNode).checked : (node as RadioNode).checked;
  if (value === 'mixed') {
    return 'mixed';
  }
  return value ? 'on' : 'off';
}

/** `aria-checked` for the state, or undefined so the attribute is omitted
 * entirely on items that are not checkable. */
function checkedAttr(state: CheckState): string | undefined {
  if (state === 'none') {
    return undefined;
  }
  return state === 'on' ? 'true' : state === 'mixed' ? 'mixed' : 'false';
}

function roleFor(node: LeafNode): 'menuitem' | 'menuitemcheckbox' | 'menuitemradio' {
  let kind = node.kind ?? 'command';
  return kind === 'toggle'
    ? 'menuitemcheckbox'
    : kind === 'radio'
      ? 'menuitemradio'
      : 'menuitem';
}

/** One focusable row of one open level. */
export interface MenuRow {
  key: string;
  depth: number;
  node: LeafNode;
  role: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio';
  label: string;
  shortcut?: string;
  keyshortcuts?: string;
  disabled: boolean;
  destructive: boolean;
  isDefault: boolean;
  hasSubmenu: boolean;
  haspopup?: string;
  checked?: string;
  check: CheckState;
  /** icon-registry name — drawn only where the check column is free, which
   * is exactly the rows whose role is plain `menuitem` (children of a
   * children-presentational role may not be components) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- icon
  // components are invoked dynamically; same contract as icon-registry
  icon?: any;
}

/** A rendered run of the panel. Separators and group headers carry no rows of
 * their own; a plain item is a one-row run — one markup for every kind, which
 * is what keeps the `menuitemcheckbox` lint constraint from forking the
 * template. */
export interface Slot {
  type: 'separator' | 'group' | 'row';
  key: string;
  label?: string;
  labelId?: string;
  /** 'group' for a labelled section, 'none' for a bare run — the wrapper is
   * presentational either way, so ARIA still sees menu → menuitem */
  role: string;
  rows: MenuRow[];
}

export interface MenuLevel {
  depth: number;
  slots: Slot[];
  rows: MenuRow[];
  label: string;
  parentKey?: string;
}

function isSeparator(entry: MenuEntry): entry is '---' {
  return entry === '---';
}
function isSection(entry: MenuEntry): entry is SectionNode {
  return !isSeparator(entry) && (entry as SectionNode).kind === 'section';
}

/** Applies a dynamic item's `alt` overlay. Shallow by design: `alt` may
 * change the label, shortcut, destructiveness or handler — never the kind. */
function resolveNode(node: LeafNode, altHeld: boolean): LeafNode {
  if (!altHeld || !node.alt) {
    return node;
  }
  return { ...node, ...node.alt } as LeafNode;
}

/** Everything `buildMenuLevel` needs that is not the entries themselves. */
export interface LevelOptions {
  /** 0 for a root panel; +1 per submenu */
  depth: number;
  /** key prefix — row keys are `${prefix}.${ordinal}`, so this must be unique
   * per open level for the roving tab stop to address one row */
  prefix: string;
  /** the panel's accessible name */
  label: string;
  /** the key of the row that opened this level, when it is a submenu */
  parentKey?: string;
  /** id namespace for generated `aria-labelledby` targets */
  guid: string;
  /** Option/Alt held — swaps in every node's `alt` overlay */
  altHeld: boolean;
  platform: ShortcutPlatform;
}

/**
 * The `MenuEntry[]` → renderable-level transform, as a pure function.
 *
 * Extracted from `Menu` so `Menubar` builds its panels from the identical
 * rules: the same ellipsis convention, the same check states, the same
 * platform shortcut faces, the same section/separator handling. A menubar
 * that built its own rows would drift from `Menu` on the first HIG detail
 * anyone changed — which is the failure this shape prevents.
 */
export function buildMenuLevel(
  entries: MenuEntry[],
  opts: LevelOptions,
): MenuLevel {
  let { depth, prefix, guid, altHeld, platform } = opts;
  let slots: Slot[] = [];
  let rows: MenuRow[] = [];
  let ordinal = 0;
  let makeRow = (node: LeafNode): MenuRow => {
    let key = `${prefix}.${ordinal++}`;
    let resolved = resolveNode(node, altHeld);
    let check = checkStateOf(resolved);
    let hasSubmenu = (resolved.kind ?? 'command') === 'submenu';
    let row: MenuRow = {
      key,
      depth,
      node: resolved,
      role: roleFor(resolved),
      label: resolved.needsInput
        ? `${resolved.label}${ELLIPSIS}`
        : resolved.label,
      shortcut: formatShortcut(resolved.kbd, platform),
      keyshortcuts: ariaKeyShortcuts(resolved.kbd, platform),
      disabled: !!resolved.disabled,
      destructive: !!resolved.destructive,
      isDefault: !!resolved.isDefault,
      hasSubmenu,
      haspopup: hasSubmenu ? 'menu' : undefined,
      checked: checkedAttr(check),
      check,
      icon: check === 'none' ? iconFor(resolved.icon) : undefined,
    };
    rows.push(row);
    return row;
  };

  for (let i = 0; i < entries.length; i++) {
    let entry = entries[i];
    if (isSeparator(entry)) {
      slots.push({
        type: 'separator',
        key: `${prefix}.sep${i}`,
        role: 'none',
        rows: [],
      });
    } else if (isSection(entry)) {
      let groupRows: MenuRow[] = [];
      for (let child of entry.items) {
        if (!isSeparator(child) && !isSection(child)) {
          groupRows.push(makeRow(child));
        }
      }
      slots.push({
        type: 'group',
        key: `${prefix}.grp${i}`,
        label: entry.label,
        labelId: `${guid}-grp-${depth}-${i}`,
        role: 'group',
        rows: groupRows,
      });
    } else {
      let row = makeRow(entry);
      slots.push({ type: 'row', key: row.key, role: 'none', rows: [row] });
    }
  }
  return { depth, slots, rows, label: opts.label, parentKey: opts.parentKey };
}

// ── The panel ────────────────────────────────────────────────────────────

export interface MenuPanelSignature {
  Args: {
    /** the level to draw */
    level: MenuLevel;
    /** the element the panel is positioned against */
    anchor?: HTMLElement;
    placement: PopupPlacement;
    /** gap between anchor and panel, in px */
    distance: number;
    /** key of the row holding the composite's single tab stop */
    rovingKey?: string;
    /** true only while the keyboard is driving — a row takes REAL focus on
     * the render where it became the tab stop, never on a pointer path */
    navigating: boolean;
    /** keys of rows whose submenu is open, for `aria-expanded` */
    openKeys: string[];
    /** row element registry — called with the element on install and with
     * `undefined` on teardown. The caller stores these in a plain (untracked)
     * Map: a tracked write from inside a modifier body is a backtracking
     * re-render. */
    onItemElement?: (key: string, el: HTMLElement | undefined) => void;
    /** the row element this panel hangs off, for the safe-triangle edge */
    parentItem?: HTMLElement;
    /** receives the panel's near edge on placement and on resize */
    onEdge?: (edge: SafeEdge | undefined) => void;
  };
  Element: HTMLElement;
}

/**
 * One rendered menu level: the panel markup and its whole stylesheet, shared
 * by `Menu` and `Menubar`.
 *
 * It is deliberately dumb — no state, no keyboard, no open/close. Every
 * decision (which row is the tab stop, which submenus are open, where focus
 * goes next) belongs to the composite that owns the panel, because that is
 * the ONLY thing the two patterns disagree about. Sharing the markup means
 * the four item kinds, the `require-presentational-children` workaround, the
 * ellipsis, the drawn checkmark and the mixed-state dash cannot drift apart
 * between a dropdown and an application menu bar.
 */
export class MenuPanel extends Component<MenuPanelSignature> {
  isSeparatorSlot = (slot: Slot): boolean => slot.type === 'separator';
  isRoving = (row: MenuRow): boolean => row.key === this.args.rovingKey;
  isFocusTarget = (row: MenuRow): boolean =>
    this.args.navigating && row.key === this.args.rovingKey;
  isActive = (row: MenuRow): boolean => row.key === this.args.rovingKey;
  isExpanded = (row: MenuRow): string | undefined =>
    row.hasSubmenu
      ? this.args.openKeys.includes(row.key)
        ? 'true'
        : 'false'
      : undefined;

  captureItem = modifier((el: HTMLElement, [key]: [string]) => {
    this.args.onItemElement?.(key, el);
    return () => this.args.onItemElement?.(key, undefined);
  });

  /** Reports the panel's near edge for the safe triangle. Measured when the
   * panel opens and on resize — never per pointer event. */
  registerEdge = modifier(
    (el: HTMLElement, [parentItem]: [HTMLElement | undefined]) => {
      if (!parentItem || !this.args.onEdge) {
        return undefined;
      }
      let update = () => {
        let panel = el.getBoundingClientRect();
        let anchor = parentItem.getBoundingClientRect();
        this.args.onEdge?.(
          safeEdgeFor(panel, panel.left >= anchor.right - 4 ? 'right' : 'left'),
        );
      };
      update();
      window.addEventListener('resize', update);
      return () => {
        window.removeEventListener('resize', update);
        this.args.onEdge?.(undefined);
      };
    },
  );

  <template>
    <menu
      class='pretui-menu'
      role='menu'
      aria-label={{@level.label}}
      data-depth={{@level.depth}}
      data-test-pretui-menu-panel={{@level.depth}}
      {{anchorTo @anchor @placement @distance false}}
      {{this.registerEdge @parentItem}}
      ...attributes
    >
      {{#each @level.slots key='key' as |slot|}}
        {{#if (this.isSeparatorSlot slot)}}
          <li class='pretui-menusep' role='separator'></li>
        {{else}}
          {{!-- one item markup for all four kinds. A labelled section becomes
                role='group'; a plain run wraps in a presentational one, which
                ARIA skips — so menu still sees menuitem children either way,
                and no kind gets a second markup that could drift. --}}
          <li
            class='pretui-menugroup'
            role='none'
            data-labelled={{if slot.label 'true'}}
          >
            {{#if slot.label}}
              <span
                class='pretui-menugroup-label'
                id={{slot.labelId}}
              >{{slot.label}}</span>
            {{/if}}
            <menu role={{slot.role}} aria-labelledby={{slot.labelId}}>
              {{#each slot.rows key='key' as |row|}}
                <li
                  class='pretui-menuitem'
                  role={{row.role}}
                  data-menu-key={{row.key}}
                  data-active={{if (this.isActive row) 'true'}}
                  data-destructive={{if row.destructive 'true'}}
                  data-default={{if row.isDefault 'true'}}
                  data-check={{row.check}}
                  data-submenu={{if row.hasSubmenu 'true'}}
                  aria-disabled={{if row.disabled 'true'}}
                  aria-checked={{row.checked}}
                  aria-haspopup={{row.haspopup}}
                  aria-expanded={{this.isExpanded row}}
                  aria-keyshortcuts={{row.keyshortcuts}}
                  {{rovingTabindex (this.isRoving row)}}
                  {{focusWhen (this.isFocusTarget row)}}
                  {{this.captureItem row.key}}
                >
                  {{#if row.icon}}
                    <row.icon class='pretui-menuicon' role='presentation' />
                  {{else}}
                    <span class='pretui-menucheck' aria-hidden='true'></span>
                  {{/if}}
                  <span class='pretui-menulabel'>{{row.label}}</span>
                  {{#if row.shortcut}}
                    <span
                      class='pretui-menukbd'
                      aria-hidden='true'
                    >{{row.shortcut}}</span>
                  {{/if}}
                  {{#if row.hasSubmenu}}
                    <span class='pretui-menuchevron' aria-hidden='true'></span>
                  {{/if}}
                </li>
              {{/each}}
            </menu>
          </li>
        {{/if}}
      {{/each}}
    </menu>

    <style scoped>
      .pretui-menu {
        /* anchored overlays must escape scroll clipping; measured on open
           only — never during prerender (lint warns, accepted, same as
           overlay.gts Popup) */
        position: fixed;
        top: 0;
        left: 0;
        /* Named, not invented. The kit's stacking components each picked their
           own number, which is why none of them can be ordered against the
           others; this consumes the shared scale and re-tints the moment the
           token lands. The palette needs no z-index at all — a native
           <dialog> lives in the top layer, above every stacking context. */
        z-index: var(--pretui-z-dropdown, 60);
        margin: 0;
        padding: var(--pretui-menu-padding, 5px);
        list-style: none;
        min-width: var(--pretui-menu-min-width, 200px);
        max-width: var(--pretui-menu-max-width, 320px);
        max-height: min(60vh, 520px);
        overflow-y: auto;
        overscroll-behavior: contain;
        background: var(--popover);
        color: var(--foreground);
        border-radius: var(--radius-surface, 10px);
        box-shadow: var(
          --pretui-shadow-overlay,
          0 0 0 1px var(--border),
          0 8px 28px rgb(0 0 0 / 0.16)
        );
        font-family: var(--font-sans);
        font-size: var(--text-ui-md, 12.5px);
        opacity: 1;
        transform: none;
        transition:
          opacity 120ms cubic-bezier(0.23, 1, 0.32, 1),
          transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
      }
      @starting-style {
        .pretui-menu {
          opacity: 0;
          transform: translateY(-3px) scale(0.985);
        }
      }
      .pretui-menu menu {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .pretui-menugroup {
        display: block;
      }
      .pretui-menugroup[data-labelled='true'] {
        padding-block-start: 3px;
      }
      .pretui-menugroup-label {
        display: block;
        padding-block: 3px;
        padding-inline: 8px;
        font-size: var(--text-ui-xs, 11px);
        font-weight: 600;
        letter-spacing: var(--track-eyebrow, 0.06em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .pretui-menuitem {
        position: relative;
        display: grid;
        grid-template-columns: 15px 1fr auto;
        align-items: center;
        gap: 8px;
        min-height: var(--pretui-menu-item-height, 28px);
        padding-block: 3px;
        padding-inline: 6px 8px;
        border-radius: var(--radius-control, 6px);
        color: inherit;
        cursor: default;
        user-select: none;
        scroll-margin: 6px;
      }
      .pretui-menuitem[data-submenu='true'] {
        grid-template-columns: 15px 1fr auto auto;
      }
      .pretui-menuitem[data-default='true'] .pretui-menulabel {
        font-weight: 600;
      }
      .pretui-menuitem[data-destructive='true'] {
        color: var(--pretui-destructive-ink, var(--boxel-danger));
      }
      .pretui-menuitem[aria-disabled='true'] {
        /* dimmed, still focusable, still announced — HIG's "dim, don't
           remove", which the `disabled` attribute cannot express */
        opacity: 0.42;
      }
      .pretui-menuitem[data-active='true']:not([aria-disabled='true']) {
        background: var(--hover, var(--boxel-100));
      }
      .pretui-menuitem[data-active='true'][data-destructive='true'] {
        background: color-mix(
          in oklch,
          var(--destructive) 12%,
          var(--popover)
        );
      }
      .pretui-menuitem:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: -2px;
      }
      .pretui-menulabel {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pretui-menuicon {
        width: 14px;
        height: 14px;
        color: var(--muted-foreground);
      }
      .pretui-menukbd {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground);
        white-space: nowrap;
      }
      .pretui-menuitem[data-active='true'] .pretui-menukbd {
        color: inherit;
      }

      /* The checkmark is drawn, not typed: a glyph inherits whatever the
         reader's emoji font does to it and ignores currentColor. */
      .pretui-menucheck {
        position: relative;
        width: 15px;
        height: 15px;
      }
      .pretui-menuitem[data-check='on'] .pretui-menucheck::after {
        content: '';
        position: absolute;
        inset-block-start: 2px;
        inset-inline-start: 4px;
        width: 5px;
        height: 9px;
        border: solid currentColor;
        border-width: 0 1.75px 1.75px 0;
        transform: rotate(43deg);
      }
      .pretui-menuitem[data-check='mixed'] .pretui-menucheck::after {
        /* the partial state a multi-selection produces — a dash, with
           aria-checked='mixed' carrying it to assistive tech */
        content: '';
        position: absolute;
        inset-block-start: 6px;
        inset-inline-start: 2px;
        width: 9px;
        height: 1.75px;
        background: currentColor;
        border-radius: 1px;
      }
      .pretui-menuchevron {
        position: relative;
        width: 10px;
        height: 10px;
        margin-inline-start: 2px;
      }
      .pretui-menuchevron::after {
        content: '';
        position: absolute;
        inset-block-start: 2px;
        inset-inline-start: 2px;
        width: 5px;
        height: 5px;
        border: solid currentColor;
        border-width: 1.5px 1.5px 0 0;
        transform: rotate(45deg);
        opacity: 0.75;
      }
      .pretui-menusep {
        height: 1px;
        margin-block: 4px;
        margin-inline: 6px;
        background: var(--border);
      }

      /* Touch: a 28px row is a miss target on a finger. */
      @media (any-pointer: coarse) {
        .pretui-menuitem {
          min-height: 44px;
        }
      }
      /* Reduced motion lands on the end state: with no transition the
         @starting-style values are never interpolated toward. */
      @media (prefers-reduced-motion: reduce) {
        .pretui-menu {
          transition: none;
        }
      }
    </style>
  </template>
}

// ── The Menu ─────────────────────────────────────────────────────────────

export interface MenuSignature {
  Args: {
    /** the menu's contents. `MenuItemSpec` objects and `'---'` from before
     * the rebuild are valid `MenuEntry` values, unchanged. */
    items: MenuEntry[];
    /** which edge of the trigger the panel aligns to (default 'start') */
    align?: 'start' | 'end';
    /** full placement control; overrides @align */
    placement?: PopupPlacement;
    /** accessible name for the root panel (default 'Menu') */
    label?: string;
    /** controlled open state; omit for uncontrolled */
    open?: boolean;
    /** fires whenever the menu wants to open or close */
    onOpenChange?: (open: boolean) => void;
    /** fires after any item activates, alongside the node's own onSelect */
    onSelect?: (node: LeafNode) => void;
    /** anchor the root panel to something other than the trigger — this is
     * what makes SelectionMenu / a toolbar menu the same component */
    anchorElement?: HTMLElement;
    /** ms of hover before a submenu opens (default 110) */
    hoverDelay?: number;
    /** ms the safe triangle keeps deferring a sibling's hover (default 300) */
    safeDelay?: number;
    /** force the shortcut platform (docs pages use it) */
    platform?: ShortcutPlatform;
  };
  Blocks: {
    /** the control that opens the menu. Receives the open state and a toggle;
     * the component finds the focusable control inside this block and gives
     * it `aria-haspopup`, a live `aria-expanded` and the APG arrow keys
     * itself, so a caller that wires only `{{on 'click' toggle}}` still gets
     * the whole contract. */
    trigger: [open: boolean, toggle: () => void];
  };
  Element: HTMLSpanElement;
}

export class Menu extends Component<MenuSignature> {
  private guid = guidFor(this);
  private timers = new OwnedTimers();
  private track = new PointerTrack();
  private typeahead = new TypeaheadBuffer(this.timers);
  private elements = new Map<string, HTMLElement>();
  private triggerControl: HTMLElement | undefined;
  private hoverHandle: ReturnType<typeof setTimeout> | undefined;
  private lastDeferStamp = -1;

  @tracked private internalOpen = false;
  @tracked private openPath: string[] = [];
  @tracked private focusKey: string | undefined;
  /** true only while the keyboard is driving — focusWhen never fires on a
   * pointer path or a plain re-render */
  @tracked private navigating = false;
  @tracked private altHeld = false;
  // Deliberately NOT @tracked. Both are written from inside a modifier body
  // and read from another modifier's arguments; a tracked property read and
  // written in the same computation is a backtracking re-render, which
  // corrupts Glimmer's renderer for the rest of the page. Untracked is also
  // sufficient: modifier arguments are evaluated at INSTALL time in document
  // order, and the trigger span precedes every panel in this template, so the
  // element is always captured before a panel asks for it.
  private triggerEl: HTMLElement | undefined;
  private hostEl: HTMLElement | undefined;

  get isOpen(): boolean {
    return this.args.open ?? this.internalOpen;
  }
  get platform(): ShortcutPlatform {
    return this.args.platform ?? detectShortcutPlatform();
  }
  get rootLabel(): string {
    return this.args.label ?? 'Menu';
  }
  private get hoverDelay(): number {
    return this.args.hoverDelay ?? 110;
  }
  private get safeDelay(): number {
    return this.args.safeDelay ?? 300;
  }

  // ── Level construction ────────────────────────────────────────────────

  private buildLevel(
    entries: MenuEntry[],
    depth: number,
    prefix: string,
    label: string,
    parentKey?: string,
  ): MenuLevel {
    return buildMenuLevel(entries, {
      depth,
      prefix,
      label,
      parentKey,
      guid: this.guid,
      altHeld: this.altHeld,
      platform: this.platform,
    });
  }

  /** Root plus one level per open submenu, outermost first. */
  get levels(): MenuLevel[] {
    if (!this.isOpen) {
      return [];
    }
    let out: MenuLevel[] = [
      this.buildLevel(this.args.items ?? [], 0, 'r', this.rootLabel),
    ];
    for (let depth = 0; depth < this.openPath.length; depth++) {
      let parentKey = this.openPath[depth];
      let parent = out[depth]?.rows.find((row) => row.key === parentKey);
      if (!parent || !parent.hasSubmenu) {
        break;
      }
      let node = parent.node as SubmenuNode;
      out.push(
        this.buildLevel(
          node.items ?? [],
          depth + 1,
          parentKey,
          parent.label,
          parentKey,
        ),
      );
    }
    return out;
  }

  /** The level the KEYBOARD is in — the one holding the focused row, which is
   * not always the deepest open one. Hovering a submenu parent opens its
   * panel without moving focus off the parent (OS parity), and from there
   * ArrowDown must walk the parent's own siblings, not the submenu. */
  private get focusLevel(): MenuLevel | undefined {
    let levels = this.levels;
    if (!levels.length) {
      return undefined;
    }
    let current = this.focusKey;
    if (current) {
      let hit = levels.find((level) =>
        level.rows.some((row) => row.key === current),
      );
      if (hit) {
        return hit;
      }
    }
    return levels[levels.length - 1];
  }

  /** The single tab stop: the focused row, or its level's first row when the
   * focused one no longer exists (its branch collapsed under it). */
  get rovingKey(): string | undefined {
    let level = this.focusLevel;
    if (!level) {
      return undefined;
    }
    let current = this.focusKey;
    if (current && level.rows.some((row) => row.key === current)) {
      return current;
    }
    return level.rows[0]?.key;
  }

  /** Element registry, handed to every `MenuPanel`. A plain Map, deliberately
   * untracked: it is written from inside a modifier body. */
  onItemElement = (key: string, el: HTMLElement | undefined) => {
    if (el) {
      this.elements.set(key, el);
    } else {
      this.elements.delete(key);
    }
  };

  /** Receives the open submenu's near edge from its panel. */
  onEdge = (edge: SafeEdge | undefined) => {
    this.track.edge = edge;
  };

  itemFor = (key: string | undefined): HTMLElement | undefined =>
    key ? this.elements.get(key) : undefined;

  // ── Open / close ──────────────────────────────────────────────────────

  private setOpen(next: boolean) {
    if (this.args.open === undefined) {
      this.internalOpen = next;
    }
    this.args.onOpenChange?.(next);
  }

  private openMenu(focusLast: boolean) {
    this.openPath = [];
    this.typeahead.reset();
    this.setOpen(true);
    let rows = this.buildLevel(
      this.args.items ?? [],
      0,
      'r',
      this.rootLabel,
    ).rows;
    let target = focusLast ? rows[rows.length - 1] : rows[0];
    this.focusKey = target?.key;
    this.navigating = true;
  }

  close = () => {
    this.timers.cancel(this.hoverHandle);
    this.hoverHandle = undefined;
    this.openPath = [];
    this.focusKey = undefined;
    this.navigating = false;
    this.altHeld = false;
    this.typeahead.reset();
    this.setOpen(false);
  };

  /** Closes and returns focus where the reader left it (APG). Focus moves
   * before the panel is torn down, so Tab continues from the trigger. */
  private dismiss = () => {
    this.close();
    this.triggerControl?.focus();
  };

  toggle = () => {
    if (this.isOpen) {
      this.dismiss();
    } else {
      this.openMenu(false);
    }
  };

  // ── Activation ────────────────────────────────────────────────────────

  private openSubmenu(row: MenuRow, focusFirst: boolean) {
    if (!row.hasSubmenu || row.disabled) {
      return;
    }
    this.openPath = [...this.openPath.slice(0, row.depth), row.key];
    if (focusFirst) {
      let child = this.levels[row.depth + 1]?.rows[0];
      if (child) {
        this.focusKey = child.key;
        this.navigating = true;
      }
    }
  }

  private closeLevel() {
    if (this.openPath.length === 0) {
      this.dismiss();
      return;
    }
    let parentKey = this.openPath[this.openPath.length - 1];
    this.openPath = this.openPath.slice(0, -1);
    this.focusKey = parentKey;
    this.navigating = true;
  }

  private activate(row: MenuRow) {
    // The aria-disabled contract: visible, focusable, announced — and inert.
    if (row.disabled) {
      return;
    }
    if (row.hasSubmenu) {
      this.openSubmenu(row, true);
      return;
    }
    let node = row.node;
    if (node.kind === 'toggle') {
      // HIG: flipping a checkmark closes the menu, like any other command.
      node.onChange?.(node.checked !== true);
    }
    node.onSelect?.();
    this.args.onSelect?.(node);
    this.dismiss();
  }

  // ── Pointer ───────────────────────────────────────────────────────────

  private rowFor(key: string | undefined): MenuRow | undefined {
    if (!key) {
      return undefined;
    }
    for (let level of this.levels) {
      let hit = level.rows.find((row) => row.key === key);
      if (hit) {
        return hit;
      }
    }
    return undefined;
  }

  private rowFromEvent(event: Event): MenuRow | undefined {
    let target = event.target as HTMLElement | null;
    let el = target?.closest('[data-menu-key]') as HTMLElement | null;
    return this.rowFor(el?.dataset.menuKey);
  }

  /**
   * Hover, with the Amazon safe triangle in front of it.
   *
   * A submenu opens to the side of its parent row, so reaching its contents
   * means moving diagonally — and that diagonal crosses sibling rows. The
   * naive implementation lets each crossed sibling win its pointer enter,
   * closes the open submenu and opens the wrong one: the submenu flickers
   * away exactly as it is reached for. While the pointer is travelling into
   * the open submenu's near edge this defers the sibling's hover and
   * re-checks after `safeDelay`. A pointer that stops moving stops
   * qualifying, so the sibling always wins in the end.
   *
   * Pointer-only. Arrow keys open and close submenus directly, so if the
   * triangle is disabled or wrong, every action is still reachable.
   */
  private considerHover(row: MenuRow) {
    this.timers.cancel(this.hoverHandle);
    this.hoverHandle = undefined;
    let openAtDepth = this.openPath[row.depth];
    let wouldCloseSubmenu = !!openAtDepth && openAtDepth !== row.key;
    if (
      wouldCloseSubmenu &&
      this.track.travellingToSubmenu &&
      // one deferral per pointer move: a cursor that comes to rest inside the
      // triangle must NOT keep re-arming the grace timer, or the sibling
      // never wins and the timer never stops
      this.track.stamp !== this.lastDeferStamp
    ) {
      this.lastDeferStamp = this.track.stamp;
      this.hoverHandle = this.timers.after(this.safeDelay, () =>
        this.considerHover(row),
      );
      return;
    }
    // Hover moves real focus, not just the highlight — the WAI-ARIA menu
    // pattern says so, and it is what keeps the keyboard alive after a
    // pointer detour: leaving focus on a row that is no longer the tab stop
    // strands it on the body the moment that row is torn down.
    this.navigating = true;
    this.focusKey = row.key;
    this.openPath = this.openPath.slice(0, row.depth);
    if (row.hasSubmenu && !row.disabled) {
      this.hoverHandle = this.timers.after(this.hoverDelay, () =>
        this.openSubmenu(row, false),
      );
    }
  }

  onPointerOver = (event: Event) => {
    let row = this.rowFromEvent(event);
    if (!row || row.key === this.focusKey) {
      return;
    }
    this.considerHover(row);
  };

  onClick = (event: Event) => {
    let row = this.rowFromEvent(event);
    if (row) {
      this.activate(row);
    }
  };

  onDocumentPointerDown = (event: Event) => {
    if (!this.isOpen) {
      return;
    }
    let target = event.target as Node | null;
    if (target && this.hostEl?.contains(target)) {
      return;
    }
    // ember-power-select renders its dropdown in a portal at document.body;
    // treat that portal as logically inside, so choosing an option from a
    // Select hosted in a menu does not dismiss the menu underneath it
    let el = target instanceof Element ? target : null;
    if (el?.closest('.ember-basic-dropdown-content')) {
      return;
    }
    this.close();
  };

  /** Option/Alt swaps dynamic items while held. Watched on the document so a
   * modifier press with the pointer outside the panel still registers. */
  onAltDown = (event: Event) => {
    if ((event as KeyboardEvent).altKey && !this.altHeld) {
      this.altHeld = true;
    }
  };
  onAltUp = (event: Event) => {
    if (!(event as KeyboardEvent).altKey && this.altHeld) {
      this.altHeld = false;
    }
  };

  /**
   * Escape, taken in the capture phase. An open menu owns Escape outright:
   * it closes exactly ONE level and nothing else in the page hears the key.
   * Without capture, a host surface listening on capture would act first and
   * Escape would mean two things at once — the defect the boxel-catalog
   * popover fork documents.
   */
  onEscapeCapture = (event: Event) => {
    let ev = event as KeyboardEvent;
    if (ev.key !== 'Escape' || !this.isOpen) {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    this.closeLevel();
  };

  // ── Keyboard ──────────────────────────────────────────────────────────

  private moveTo(row: MenuRow | undefined) {
    if (!row) {
      return;
    }
    this.navigating = true;
    this.focusKey = row.key;
    // moving within a level closes anything deeper
    this.openPath = this.openPath.slice(0, row.depth);
  }

  onKeydown = (event: Event) => {
    let ev = event as KeyboardEvent;
    let level = this.focusLevel;
    if (!level) {
      return;
    }
    let rows = level.rows;
    let index = rows.findIndex((row) => row.key === this.rovingKey);
    let row = rows[index];
    let key = ev.key;

    if (key === 'Escape') {
      // handled in the capture phase (onEscapeCapture) so a host that listens
      // for Escape on capture cannot act on it first
      return;
    }
    if (key === 'Tab') {
      // Tab closes the whole menu and moves on. No preventDefault: focus is
      // put back on the trigger first, so the browser's own tab order
      // continues from there — which is what the APG asks for.
      this.dismiss();
      return;
    }
    if (ev.ctrlKey || ev.metaKey || rows.length === 0) {
      return;
    }
    if (key === 'ArrowDown') {
      ev.preventDefault();
      this.moveTo(rows[(index + 1 + rows.length) % rows.length]);
    } else if (key === 'ArrowUp') {
      ev.preventDefault();
      this.moveTo(rows[(index - 1 + rows.length) % rows.length]);
    } else if (key === 'Home') {
      ev.preventDefault();
      this.moveTo(rows[0]);
    } else if (key === 'End') {
      ev.preventDefault();
      this.moveTo(rows[rows.length - 1]);
    } else if (key === 'ArrowRight') {
      if (row?.hasSubmenu && !row.disabled) {
        ev.preventDefault();
        this.openSubmenu(row, true);
      }
    } else if (key === 'ArrowLeft') {
      if (level.depth > 0) {
        ev.preventDefault();
        this.closeLevel();
      }
    } else if (key === 'Enter' || key === ' ') {
      ev.preventDefault();
      if (row) {
        this.activate(row);
      }
    } else if (!ev.altKey && key.length === 1 && /\S/.test(key)) {
      let prefix = this.typeahead.push(key);
      let hit = typeaheadIndex(
        rows.map((candidate) => candidate.label),
        prefix,
        index < 0 ? 0 : index,
        this.typeahead.isCycling,
      );
      if (hit >= 0) {
        ev.preventDefault();
        this.moveTo(rows[hit]);
      }
    }
  };

  // ── Element wiring ────────────────────────────────────────────────────

  captureHost = modifier((el: HTMLElement) => {
    this.hostEl = el;
  });

  /** Records the trigger element and the focusable control inside it. Split
   * from `triggerBehavior` on purpose: this one takes no arguments, so it
   * runs exactly once and never re-enters while the menu opens and closes. */
  captureTrigger = modifier((el: HTMLElement) => {
    this.triggerEl = el;
    this.triggerControl =
      (el.querySelector(
        'button, [role="button"], a[href], input, select, textarea, [tabindex]',
      ) as HTMLElement | null) ?? el;
  });

  /**
   * Gives the caller's trigger the APG menu-button contract without the
   * caller having to know about it: `aria-haspopup='menu'`, a live
   * `aria-expanded`, and ArrowDown/ArrowUp to open (Down lands on the first
   * item, Up on the last). Enter/Space are deliberately NOT handled — every
   * real button already fires `click` on those, and intercepting them would
   * open and immediately re-toggle. Every attribute is restored on teardown,
   * so the caller's element is left exactly as it was found.
   */
  triggerBehavior = modifier((el: HTMLElement, [isOpen]: [boolean]) => {
    let control =
      (el.querySelector(
        'button, [role="button"], a[href], input, select, textarea, [tabindex]',
      ) as HTMLElement | null) ?? el;
    let hadPopup = control.getAttribute('aria-haspopup');
    control.setAttribute('aria-haspopup', 'menu');
    control.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    let onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return;
      }
      event.preventDefault();
      // the wrapper's delegated handler must not see this same event and
      // move the selection a second time
      event.stopPropagation();
      this.openMenu(event.key === 'ArrowUp');
    };
    control.addEventListener('keydown', onKeydown);
    return () => {
      control.removeEventListener('keydown', onKeydown);
      if (hadPopup === null) {
        control.removeAttribute('aria-haspopup');
      } else {
        control.setAttribute('aria-haspopup', hadPopup);
      }
      control.removeAttribute('aria-expanded');
    };
  });

  anchorFor = (depth: number): HTMLElement | undefined =>
    depth === 0
      ? (this.args.anchorElement ?? this.triggerEl)
      : this.elements.get(this.openPath[depth - 1]);

  placementFor = (depth: number): PopupPlacement =>
    depth === 0
      ? (this.args.placement ??
        (this.args.align === 'end' ? 'bottom-end' : 'bottom-start'))
      : 'right-start';

  distanceFor = (depth: number): number => (depth === 0 ? 4 : 2);

  <template>
    <span
      class='pretui-menuwrap'
      data-test-pretui-menu
      {{this.captureHost}}
      {{ownsTimers this.timers}}
      {{listen 'click' this.onClick}}
      {{listen 'keydown' this.onKeydown}}
      {{listen 'pointerover' this.onPointerOver}}
      ...attributes
    >
      <span
        class='pretui-menu-trigger'
        {{this.captureTrigger}}
        {{this.triggerBehavior this.isOpen}}
      >
        {{yield this.isOpen this.toggle to='trigger'}}
      </span>

      {{#if this.isOpen}}
        {{! dismissal, dynamic items and the pointer track live only while the
            menu is open — every listener leaves with the element }}
        <span
          class='pretui-menu-watch'
          {{tracksPointer this.track}}
          {{listenDocumentCapture 'keydown' this.onEscapeCapture}}
          {{listenDocument 'pointerdown' this.onDocumentPointerDown true}}
          {{listenDocument 'keydown' this.onAltDown false}}
          {{listenDocument 'keyup' this.onAltUp false}}
        ></span>

        {{#each this.levels key='depth' as |level|}}
          <MenuPanel
            @level={{level}}
            @anchor={{this.anchorFor level.depth}}
            @placement={{this.placementFor level.depth}}
            @distance={{this.distanceFor level.depth}}
            @rovingKey={{this.rovingKey}}
            @navigating={{this.navigating}}
            @openKeys={{this.openPath}}
            @onItemElement={{this.onItemElement}}
            @parentItem={{this.itemFor level.parentKey}}
            @onEdge={{this.onEdge}}
          />
        {{/each}}
      {{/if}}
    </span>

    <style scoped>
      .pretui-menuwrap {
        position: relative;
        display: inline-flex;
      }
      .pretui-menu-trigger {
        display: inline-flex;
      }
      .pretui-menu-watch {
        display: none;
      }
    </style>
  </template>
}

// ── Fuzzy matching (the palette's engine) ────────────────────────────────

export interface FuzzyMatch {
  score: number;
  /** [start, end) index pairs into the searched text */
  ranges: [number, number][];
}

const BOUNDARY = /[\s\-_/.:·>]/;

function isBoundary(text: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  let previous = text[index - 1];
  if (BOUNDARY.test(previous)) {
    return true;
  }
  // camelCase transition
  return (
    previous === previous.toLowerCase() &&
    previous !== previous.toUpperCase() &&
    text[index] !== text[index].toLowerCase()
  );
}

/**
 * A dependency-free fuzzy matcher with match ranges — the part of uFuzzy the
 * palette actually needs, without vendoring an engine into a tier Law 9 says
 * takes none.
 *
 * Greedy left-to-right subsequence, but each character prefers the next
 * WORD-BOUNDARY occurrence over the next raw one, so "cs" finds "Copy
 * Selection" rather than the "c" of Copy and an "s" inside it. Scoring
 * rewards contiguity, boundaries and a prefix hit, and charges for gaps.
 * Deterministic: same inputs, same score, every time.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  let needle = query.trim().toLowerCase();
  if (!needle) {
    return { score: 0, ranges: [] };
  }
  let haystack = text.toLowerCase();
  let ranges: [number, number][] = [];
  let score = 0;
  let cursor = 0;
  let previousIndex = -2;
  for (let i = 0; i < needle.length; i++) {
    let character = needle[i];
    if (character === ' ') {
      continue;
    }
    let plain = haystack.indexOf(character, cursor);
    if (plain < 0) {
      return null;
    }
    let chosen = plain;
    if (plain !== previousIndex + 1) {
      // not contiguous anyway — prefer a boundary hit further along
      for (let j = plain; j < haystack.length; j++) {
        if (haystack[j] === character && isBoundary(text, j)) {
          chosen = j;
          break;
        }
      }
    }
    if (chosen === previousIndex + 1) {
      score += 10;
      ranges[ranges.length - 1][1] = chosen + 1;
    } else {
      score += isBoundary(text, chosen) ? 8 : 2;
      score -= Math.min(6, chosen - cursor);
      ranges.push([chosen, chosen + 1]);
    }
    if (chosen === 0) {
      score += 12;
    }
    previousIndex = chosen;
    cursor = chosen + 1;
  }
  // shorter haystacks are better matches for the same query
  score += Math.max(0, 16 - Math.floor(text.length / 4));
  return { score, ranges };
}

export interface MatchSegment {
  text: string;
  hit: boolean;
}

/** Splits text into plain and matched segments for highlighting. */
export function matchSegments(
  text: string,
  ranges: [number, number][],
): MatchSegment[] {
  if (!ranges.length) {
    return [{ text, hit: false }];
  }
  let out: MatchSegment[] = [];
  let cursor = 0;
  for (let [start, end] of ranges) {
    if (start > cursor) {
      out.push({ text: text.slice(cursor, start), hit: false });
    }
    out.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < text.length) {
    out.push({ text: text.slice(cursor), hit: false });
  }
  return out;
}

// ── The command palette ──────────────────────────────────────────────────

interface PaletteEntry {
  key: string;
  node: LeafNode;
  /** ancestor labels, outermost first — the breadcrumb a flattened tree needs */
  path: string[];
  label: string;
  shortcut?: string;
  keyshortcuts?: string;
  disabled: boolean;
  destructive: boolean;
  hasSubmenu: boolean;
  check: CheckState;
  checked?: string;
  description?: string;
  haystack: string;
}

interface PaletteRow extends PaletteEntry {
  id: string;
  segments: MatchSegment[];
  pathLabel?: string;
}

interface PaletteGroup {
  key: string;
  /** the scope/section these rows sit under, when browsing */
  label?: string;
  rows: PaletteRow[];
}

export interface CommandPaletteSignature {
  Args: {
    /** the same tree `Menu` renders — one definition, two surfaces */
    items: MenuEntry[];
    open?: boolean;
    onClose: () => void;
    /** opens the palette; supply it to enable @hotkey */
    onOpen?: () => void;
    /** global shortcut that opens the palette (default 'Mod+K'); needs @onOpen */
    hotkey?: string;
    /** input placeholder */
    placeholder?: string;
    /** accessible name */
    label?: string;
    /** shown when nothing matches */
    emptyMessage?: string;
    /** fires after any command runs */
    onSelect?: (node: LeafNode) => void;
    /** force the shortcut platform */
    platform?: ShortcutPlatform;
  };
  Element: HTMLDialogElement;
}

/** Keeps the palette's native <dialog> in sync with @open and owns its
 * cancel/click listeners — `{{on}}` on a <dialog> is rejected by lint. */
const paletteModal = modifier(
  (
    el: HTMLDialogElement,
    [open, onCancel, onClick]: [
      boolean | undefined,
      (event: Event) => void,
      (event: Event) => void,
    ],
  ) => {
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
    el.addEventListener('cancel', onCancel);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('cancel', onCancel);
      el.removeEventListener('click', onClick);
    };
  },
);

/** A non-passive document keydown for the palette's global hotkey — it has to
 * preventDefault, which a passive listener may not. Removed on teardown. */
const hotkeyListener = modifier(
  (_el: HTMLElement, [handler]: [(event: Event) => void]) => {
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  },
);

/** Scrolls the active row into view — no timer, and no smooth scroll that
 * would lag behind held arrow keys. */
const scrollIntoViewWhen = modifier((el: HTMLElement, [should]: [boolean]) => {
  if (should) {
    el.scrollIntoView({ block: 'nearest' });
  }
});

export class CommandPalette extends Component<CommandPaletteSignature> {
  private guid = guidFor(this);
  @tracked private query = '';
  /** keys of the submenu scopes the reader has descended into (kbar's model,
   * which is how nesting survives being flattened) */
  @tracked private scope: string[] = [];
  @tracked private activeKey: string | undefined;

  get platform(): ShortcutPlatform {
    return this.args.platform ?? detectShortcutPlatform();
  }
  get label(): string {
    return this.args.label ?? 'Command palette';
  }
  get placeholder(): string {
    return this.args.placeholder ?? 'Type a command or search…';
  }
  get emptyMessage(): string {
    return this.args.emptyMessage ?? 'No matching commands';
  }
  get listId(): string {
    return `${this.guid}-list`;
  }
  get inputId(): string {
    return `${this.guid}-input`;
  }
  get searching(): boolean {
    return this.query.trim().length > 0;
  }

  private entryFor(node: LeafNode, key: string, path: string[]): PaletteEntry {
    let check = checkStateOf(node);
    let label = node.needsInput ? `${node.label}${ELLIPSIS}` : node.label;
    return {
      key,
      node,
      path,
      label,
      shortcut: formatShortcut(node.kbd, this.platform),
      keyshortcuts: ariaKeyShortcuts(node.kbd, this.platform),
      disabled: !!node.disabled,
      destructive: !!node.destructive,
      hasSubmenu: (node.kind ?? 'command') === 'submenu',
      check,
      checked: checkedAttr(check),
      description: node.description,
      haystack: [label, node.description, node.keywords, ...path]
        .filter(Boolean)
        .join(' '),
    };
  }

  /** Walks a level, flattening sections (presentation, not scope) and
   * recursing into submenus when `deep`. */
  private collect(
    entries: MenuEntry[],
    prefix: string,
    path: string[],
    deep: boolean,
    out: PaletteEntry[],
  ) {
    let ordinal = 0;
    for (let entry of entries) {
      if (isSeparator(entry)) {
        continue;
      }
      if (isSection(entry)) {
        this.collect(entry.items, prefix, [...path, entry.label], deep, out);
        continue;
      }
      let key = `${prefix}.${ordinal++}`;
      let node = entry as LeafNode;
      out.push(this.entryFor(node, key, path));
      if (deep && (node.kind ?? 'command') === 'submenu') {
        this.collect(
          (node as SubmenuNode).items ?? [],
          key,
          [...path, node.label],
          true,
          out,
        );
      }
    }
  }

  /** Walks down the scope stack, returning the entries the current scope
   * exposes: its immediate children when browsing, everything beneath it
   * when searching. */
  private get scopedEntries(): PaletteEntry[] {
    let entries = this.args.items ?? [];
    let prefix = 'p';
    let path: string[] = [];
    for (let key of this.scope) {
      let level: PaletteEntry[] = [];
      this.collect(entries, prefix, path, false, level);
      let parent = level.find((entry) => entry.key === key);
      if (!parent || !parent.hasSubmenu) {
        break;
      }
      entries = (parent.node as SubmenuNode).items ?? [];
      prefix = key;
      path = [...path, parent.node.label];
    }
    let out: PaletteEntry[] = [];
    this.collect(entries, prefix, path, this.searching, out);
    return out;
  }

  /** Breadcrumb labels for the scopes the reader descended into. */
  get crumbs(): string[] {
    let entries = this.args.items ?? [];
    let prefix = 'p';
    let out: string[] = [];
    for (let key of this.scope) {
      let level: PaletteEntry[] = [];
      this.collect(entries, prefix, [], false, level);
      let parent = level.find((entry) => entry.key === key);
      if (!parent) {
        break;
      }
      out.push(parent.node.label);
      entries = (parent.node as SubmenuNode).items ?? [];
      prefix = key;
    }
    return out;
  }

  get rows(): PaletteRow[] {
    let query = this.query.trim();
    let scoped = this.scopedEntries;
    if (!query) {
      return scoped.map((entry) => ({
        ...entry,
        id: `${this.guid}-${entry.key}`,
        segments: [{ text: entry.label, hit: false }],
        pathLabel: entry.path.length ? entry.path.join(' › ') : undefined,
      }));
    }
    let scored: { entry: PaletteEntry; match: FuzzyMatch }[] = [];
    for (let entry of scoped) {
      let onLabel = fuzzyMatch(query, entry.label);
      if (onLabel) {
        scored.push({ entry, match: onLabel });
        continue;
      }
      // a keyword/description/path hit still counts, but ranks below every
      // label hit and highlights nothing (the match is not in the label)
      let wider = fuzzyMatch(query, entry.haystack);
      if (wider) {
        scored.push({ entry, match: { score: wider.score - 40, ranges: [] } });
      }
    }
    scored.sort((a, b) => b.match.score - a.match.score);
    return scored.map(({ entry, match }) => ({
      ...entry,
      id: `${this.guid}-${entry.key}`,
      segments: matchSegments(entry.label, match.ranges),
      pathLabel: entry.path.length ? entry.path.join(' › ') : undefined,
    }));
  }

  /** One unlabelled run while searching — rank order is the only order that
   * means anything — and section groups while browsing. */
  get groups(): PaletteGroup[] {
    let rows = this.rows;
    if (this.searching) {
      return [{ key: 'results', rows }];
    }
    let out: PaletteGroup[] = [];
    for (let row of rows) {
      let label = row.path[row.path.length - 1];
      let last = out[out.length - 1];
      if (last && last.label === label) {
        last.rows.push(row);
      } else {
        out.push({ key: `${row.key}-g`, label, rows: [row] });
      }
    }
    return out;
  }

  get hasRows(): boolean {
    return this.rows.length > 0;
  }
  get activeRow(): PaletteRow | undefined {
    let rows = this.rows;
    return rows.find((row) => row.key === this.activeKey) ?? rows[0];
  }
  get activeId(): string | undefined {
    return this.activeRow?.id;
  }
  get resultSummary(): string {
    if (!this.searching) {
      return '';
    }
    let count = this.rows.length;
    return count === 1 ? '1 command' : `${count} commands`;
  }
  isActive = (row: PaletteRow): boolean => row.key === this.activeRow?.key;

  // ── Interaction ───────────────────────────────────────────────────────

  private reset() {
    this.query = '';
    this.activeKey = undefined;
  }

  onInput = (event: Event) => {
    this.query = (event.target as HTMLInputElement).value;
    this.activeKey = undefined;
  };

  private enterScope(row: PaletteRow) {
    this.scope = [...this.scope, row.key];
    this.reset();
  }

  private popScope() {
    if (this.scope.length === 0) {
      this.close();
      return;
    }
    this.scope = this.scope.slice(0, -1);
    this.reset();
  }

  close = () => {
    this.scope = [];
    this.reset();
    this.args.onClose();
  };

  run = (row: PaletteRow | undefined) => {
    if (!row || row.disabled) {
      return;
    }
    if (row.hasSubmenu) {
      this.enterScope(row);
      return;
    }
    let node = row.node;
    if (node.kind === 'toggle') {
      node.onChange?.(node.checked !== true);
    }
    node.onSelect?.();
    this.args.onSelect?.(node);
    this.close();
  };

  onRowClick = (row: PaletteRow) => this.run(row);

  private move(delta: number) {
    let rows = this.rows;
    if (!rows.length) {
      return;
    }
    let index = rows.findIndex((row) => row.key === this.activeRow?.key);
    this.activeKey = rows[(index + delta + rows.length) % rows.length].key;
  }

  onKeydown = (raw: Event) => {
    let event = raw as KeyboardEvent;
    let key = event.key;
    let empty = !this.query;
    if (key === 'ArrowDown') {
      event.preventDefault();
      this.move(1);
    } else if (key === 'ArrowUp') {
      event.preventDefault();
      this.move(-1);
    } else if (key === 'Home' && empty) {
      event.preventDefault();
      this.activeKey = this.rows[0]?.key;
    } else if (key === 'End' && empty) {
      event.preventDefault();
      this.activeKey = this.rows[this.rows.length - 1]?.key;
    } else if (key === 'Enter') {
      event.preventDefault();
      this.run(this.activeRow);
    } else if (key === 'ArrowRight' && empty && this.activeRow?.hasSubmenu) {
      event.preventDefault();
      this.enterScope(this.activeRow);
    } else if (
      empty &&
      this.scope.length > 0 &&
      (key === 'Backspace' || key === 'ArrowLeft')
    ) {
      event.preventDefault();
      this.popScope();
    } else if (key === 'Escape') {
      // Escape leaves one scope at a time, exactly like Menu closes one
      // level. preventDefault keeps the <dialog>'s own cancel from firing
      // and popping a second time.
      event.preventDefault();
      event.stopPropagation();
      this.popScope();
    }
  };

  /** Backstop for an Escape that did not reach the input. */
  onCancel = (event: Event) => {
    event.preventDefault();
    this.close();
  };
  onDialogClick = (event: Event) => {
    if (event.target === event.currentTarget) {
      this.close();
    }
  };

  onHotkey = (event: Event) => {
    let ev = event as KeyboardEvent;
    let parsed = parseShortcut(this.args.hotkey ?? 'Mod+K', this.platform);
    if (!parsed || !this.args.onOpen || this.args.open) {
      return;
    }
    let wanted = new Set(parsed.mods);
    if (
      ev.metaKey !== wanted.has('Meta') ||
      ev.ctrlKey !== wanted.has('Control') ||
      ev.altKey !== wanted.has('Alt') ||
      ev.shiftKey !== wanted.has('Shift')
    ) {
      return;
    }
    if (ev.key.toLowerCase() !== parsed.key.toLowerCase()) {
      return;
    }
    ev.preventDefault();
    this.args.onOpen();
  };

  /** Focuses the input whenever the palette opens. */
  focusOnOpen = modifier(
    (el: HTMLInputElement, [open]: [boolean | undefined]) => {
      if (open) {
        el.focus();
        el.select();
      }
    },
  );

  <template>
    <dialog
      class='pretui-palette'
      aria-label={{this.label}}
      data-test-pretui-command-palette
      {{paletteModal @open this.onCancel this.onDialogClick}}
      {{hotkeyListener this.onHotkey}}
      ...attributes
    >
      <div class='pal-shell'>
        <div class='pal-field'>
          {{#if this.crumbs.length}}
            <span class='pal-crumbs' data-test-pretui-palette-crumbs>
              {{#each this.crumbs key='@index' as |crumb|}}
                <span class='pal-crumb'>{{crumb}}</span>
              {{/each}}
            </span>
          {{/if}}
          {{! A real <label>, visually hidden, rather than aria-label: realm
              lint counts aria-label alongside anything else that names the
              field as two labels, and the element the spec actually wants
              here is a label. }}
          <label for={{this.inputId}} class='pal-sr'>{{this.label}}</label>
          <span class='pal-inputwrap'>
            {{#unless this.query}}
              {{! a painted hint rather than a `placeholder` attribute: the
                  attribute counts as a second label beside aria-label (realm
                  lint), and a placeholder was never a label to begin with }}
              <span class='pal-ghost' aria-hidden='true'>{{this.placeholder}}</span>
            {{/unless}}
            <input
            id={{this.inputId}}
            class='pal-input'
            type='text'
            role='combobox'
            autocomplete='off'
            spellcheck='false'
            aria-expanded='true'
            aria-controls={{this.listId}}
            aria-autocomplete='list'
            aria-activedescendant={{this.activeId}}
            value={{this.query}}
            data-test-pretui-palette-input
            {{this.focusOnOpen @open}}
            {{on 'input' this.onInput}}
            {{on 'keydown' this.onKeydown}}
            />
          </span>
        </div>

        {{#if this.hasRows}}
          {{! Flat by necessity AND by choice: realm lint's require-context-role
              wants role='option' to be an immediate child of the listbox, so a
              role='group' wrapper is out. Nothing is lost to assistive tech —
              a row's own scope is written into it as pathLabel, which reads
              better than a group boundary a screen reader must remember. }}
          <menu
            id={{this.listId}}
            class='pal-list'
            role='listbox'
            aria-label={{this.label}}
          >
            {{#each this.groups key='key' as |group|}}
              {{#if group.label}}
                <li class='pal-group-label' role='presentation'>{{group.label}}</li>
              {{/if}}
              {{#each group.rows key='key' as |row|}}
                <li
                  class='pal-row'
                  role='option'
                  id={{row.id}}
                  aria-selected={{if (this.isActive row) 'true' 'false'}}
                  aria-disabled={{if row.disabled 'true'}}
                  aria-checked={{row.checked}}
                  aria-keyshortcuts={{row.keyshortcuts}}
                  data-active={{if (this.isActive row) 'true'}}
                  data-destructive={{if row.destructive 'true'}}
                  data-check={{row.check}}
                  {{scrollIntoViewWhen (this.isActive row)}}
                  {{on 'click' (fn this.onRowClick row)}}
                >
                  <span class='pal-check' aria-hidden='true'></span>
                  <span class='pal-text'>
                    <span class='pal-label'>
                      {{#each row.segments key='@index' as |segment|}}
                        {{#if segment.hit}}
                          <span class='pal-hit'>{{segment.text}}</span>
                        {{else}}
                          <span>{{segment.text}}</span>
                        {{/if}}
                      {{/each}}
                    </span>
                    {{#if row.description}}
                      <span class='pal-desc'>{{row.description}}</span>
                    {{else if row.pathLabel}}
                      <span class='pal-path'>{{row.pathLabel}}</span>
                    {{/if}}
                  </span>
                  {{#if row.shortcut}}
                    <span
                      class='pal-kbd'
                      aria-hidden='true'
                    >{{row.shortcut}}</span>
                  {{/if}}
                  {{#if row.hasSubmenu}}
                    <span class='pal-chevron' aria-hidden='true'></span>
                  {{/if}}
                </li>
              {{/each}}
            {{/each}}
          </menu>
        {{else}}
          <div class='pal-empty'>{{this.emptyMessage}}</div>
        {{/if}}

        {{! one polite announcement of the result count — never per keystroke
            in an assertive channel }}
        <span class='pal-sr' role='status'>{{this.resultSummary}}</span>

        <div class='pal-footer'>
          <span class='pal-hint'><Kbd @value='ArrowUp' /><Kbd
              @value='ArrowDown'
            />
            navigate</span>
          <span class='pal-hint'><Kbd @value='Enter' />
            run</span>
          <span class='pal-hint'><Kbd @value='Escape' />
            {{if this.crumbs.length 'back' 'close'}}</span>
        </div>
      </div>
    </dialog>

    <style scoped>
      .pretui-palette {
        border: 0;
        padding: 0;
        width: min(620px, calc(100vw - 32px));
        max-height: min(70dvh, 560px);
        margin-block-start: 12vh;
        background: var(--popover);
        color: var(--foreground);
        border-radius: var(--radius-surface, 12px);
        box-shadow: var(
          --pretui-shadow-overlay,
          0 0 0 1px var(--border),
          0 16px 48px rgb(16 24 40 / 0.22)
        );
        font-family: var(--font-sans);
        overflow: hidden;
        opacity: 1;
        transform: none;
        transition:
          opacity 160ms cubic-bezier(0.23, 1, 0.32, 1),
          transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
      }
      .pretui-palette::backdrop {
        background: var(--pretui-overlay-scrim, rgb(16 24 40 / 0.4));
      }
      @starting-style {
        .pretui-palette[open] {
          opacity: 0;
          transform: translateY(-8px) scale(0.985);
        }
      }
      .pal-shell {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        max-height: inherit;
      }
      .pal-field {
        display: flex;
        align-items: center;
        gap: 6px;
        padding-block: 10px;
        padding-inline: 14px;
        box-shadow: 0 1px 0 var(--border);
      }
      .pal-crumbs {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: none;
      }
      .pal-crumb {
        padding-block: 2px;
        padding-inline: 7px;
        border-radius: var(--radius-chip, 5px);
        background: var(--inset, var(--boxel-100));
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
        font-size: var(--text-ui-xs, 11px);
        font-weight: 500;
        color: var(--muted-foreground);
        white-space: nowrap;
      }
      .pal-inputwrap {
        position: relative;
        display: flex;
        flex: 1;
        min-width: 0;
      }
      .pal-ghost {
        position: absolute;
        inset-block: 0;
        inset-inline-start: 0;
        display: flex;
        align-items: center;
        font-size: var(--text-body, 15px);
        color: var(--muted-foreground);
        pointer-events: none;
      }
      .pal-input {
        flex: 1;
        min-width: 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        font-size: var(--text-body, 15px);
        padding-block: 4px;
        padding-inline: 0;
      }
      .pal-input:focus {
        outline: none;
      }
      .pal-input::placeholder {
        color: var(--muted-foreground);
      }
      .pal-list {
        margin: 0;
        padding: 6px;
        list-style: none;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      .pal-list menu {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .pal-group-label {
        display: block;
        padding-block: 6px 3px;
        padding-inline: 9px;
        font-size: var(--text-ui-xs, 11px);
        font-weight: 600;
        letter-spacing: var(--track-eyebrow, 0.06em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .pal-row {
        display: grid;
        grid-template-columns: 15px 1fr auto;
        align-items: center;
        gap: 9px;
        min-height: 36px;
        padding-block: 5px;
        padding-inline: 7px 10px;
        border-radius: var(--radius-control, 7px);
        cursor: default;
        scroll-margin: 8px;
      }
      .pal-row[data-active='true'] {
        background: var(--hover, var(--boxel-100));
      }
      .pal-row[data-destructive='true'] {
        color: var(--pretui-destructive-ink, var(--boxel-danger));
      }
      .pal-row[aria-disabled='true'] {
        opacity: 0.42;
      }
      .pal-text {
        display: grid;
        gap: 1px;
        min-width: 0;
      }
      .pal-label {
        font-size: var(--text-ui-md, 12.5px);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pal-hit {
        color: var(--pretui-palette-hit, var(--primary));
        font-weight: 600;
      }
      .pal-desc,
      .pal-path {
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pal-kbd {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground);
        white-space: nowrap;
      }
      .pal-check {
        position: relative;
        width: 15px;
        height: 15px;
      }
      .pal-row[data-check='on'] .pal-check::after {
        content: '';
        position: absolute;
        inset-block-start: 2px;
        inset-inline-start: 4px;
        width: 5px;
        height: 9px;
        border: solid currentColor;
        border-width: 0 1.75px 1.75px 0;
        transform: rotate(43deg);
      }
      .pal-row[data-check='mixed'] .pal-check::after {
        content: '';
        position: absolute;
        inset-block-start: 6px;
        inset-inline-start: 2px;
        width: 9px;
        height: 1.75px;
        background: currentColor;
        border-radius: 1px;
      }
      .pal-chevron {
        position: relative;
        width: 10px;
        height: 10px;
      }
      .pal-chevron::after {
        content: '';
        position: absolute;
        inset-block-start: 2px;
        inset-inline-start: 2px;
        width: 5px;
        height: 5px;
        border: solid currentColor;
        border-width: 1.5px 1.5px 0 0;
        transform: rotate(45deg);
        opacity: 0.75;
      }
      .pal-empty {
        padding-block: 34px;
        text-align: center;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
      }
      .pal-footer {
        display: flex;
        align-items: center;
        gap: 14px;
        padding-block: 8px;
        padding-inline: 14px;
        box-shadow: 0 -1px 0 var(--border);
        background: var(--inset, var(--boxel-100));
      }
      .pal-hint {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
      .pal-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      @media (any-pointer: coarse) {
        .pal-row {
          min-height: 44px;
        }
        .pal-footer {
          display: none;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-palette {
          transition: none;
        }
      }
    </style>
  </template>
}

// The shadcn / cmdk name for CommandPalette.
export { CommandPalette as Command };
