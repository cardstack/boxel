// Pretui — the menu tree model shared by Menu, MenuPanel, Menubar and
// CommandPalette: the node taxonomy, shortcut parsing and rendering, and the
// row model a level is drawn from. Not a component.
import { iconFor } from '../icon-registry';

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

// ── Row model ────────────────────────────────────────────────────────────

export const ELLIPSIS = '…';

export type CheckState = 'on' | 'off' | 'mixed' | 'none';

export function checkStateOf(node: LeafNode): CheckState {
  let kind = node.kind ?? 'command';
  if (kind !== 'toggle' && kind !== 'radio') {
    return 'none';
  }
  let value =
    kind === 'toggle'
      ? (node as ToggleNode).checked
      : (node as RadioNode).checked;
  if (value === 'mixed') {
    return 'mixed';
  }
  return value ? 'on' : 'off';
}

/** `aria-checked` for the state, or undefined so the attribute is omitted
 * entirely on items that are not checkable. */
export function checkedAttr(state: CheckState): string | undefined {
  if (state === 'none') {
    return undefined;
  }
  return state === 'on' ? 'true' : state === 'mixed' ? 'mixed' : 'false';
}

function roleFor(
  node: LeafNode,
): 'menuitem' | 'menuitemcheckbox' | 'menuitemradio' {
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

export function isSeparator(entry: MenuEntry): entry is '---' {
  return entry === '---';
}
export function isSection(entry: MenuEntry): entry is SectionNode {
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
