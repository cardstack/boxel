// Pretui — LayerManager: a layers panel with nesting, visibility, locking and keyboard reordering.
// Pretui — design-layers: LayerManager.
//
// The ordered, nestable, visibility-and-lock list every design tool has, and
// the one every implementation of it gets wrong in the same place.
//
// ── The naming collision, stated up front ───────────────────────────────
//
// The boxel-catalog sourcing analysis (§15) uses the name `LayerManager` for
// something else entirely: a module-level **z-index allocator** that orders
// the kit's seven stacking surfaces (`Popup`, `Popover`, `Dialog`, `Drawer`,
// `Tooltip`, `Menu`, `Toast`) inside a tier. That is a real and separate
// need, it is a utility rather than a rendered component, and Pretui already
// carries the tier scale for it in `pretui-css.gts` (`PRETUI_Z`,
// `PretuiZLayer`). The two must not share a name in one kit. This file is
// the DESIGN-TOOL layer list; the allocator wants a name of its own —
// `ZAllocator` or `StackOrder` — and its z-window rationale from the source
// is worth preserving verbatim as a comment wherever it lands.
//
// ── The one thing that makes this component worth building ──────────────
//
// E5 of the sourcing analysis audited five drag implementations across the
// corpus. Four had **no keyboard path at all** — `<div>` handlers, no
// `tabindex`, no `role`, no move-to-bucket command, no live region. A
// reorder that requires a pointer is not a reorder with a missing feature;
// it is a control half the readers cannot operate. So the keyboard path here
// is the PRIMARY implementation and the pointer path is written on top of
// it: `layerDrag` calls the very same four operations the arrow keys call,
// which is why they cannot drift apart.
//
// The four operations, and why they are the right four:
//
//   raise / lower    swap with the previous / next SIBLING
//   indent           become the last child of the previous sibling
//   outdent          become the next sibling of the parent
//
// Any position in any tree is reachable by a sequence of those four, they
// each have an obvious announcement, and each one is visually continuous —
// the row lands adjacent to where it left. The alternative model, "drop
// anywhere in the flattened list", needs hit-testing, produces ambiguous
// targets at every level boundary, and is exactly what the corpus's
// `document.elementFromPoint()` on every `pointermove` was paying for.
//
// ── Better than the inspiration (E5, and every layers panel) ────────────
//
//   • **Keyboard reorder ACROSS nesting levels**, not just within a level.
//     Up/down reorder among siblings; left/right change the nesting. E5's
//     three sources could not reorder at all without a pointer.
//   • **Two forced synchronous layouts per pointermove, deleted.** The
//     sources called `document.elementFromPoint()` on every move and then
//     `getBoundingClientRect()` on every tile in the hovered zone,
//     unthrottled. This reads ONE rect, once, at pointerdown, and derives
//     every step from pointer deltas against it.
//   • **`pointercancel` is handled.** The sources added window
//     `pointermove`/`pointerup` on drag start and removed them only in
//     `pointerup`, with no `willDestroy` and no cancel handler — so a drag
//     interrupted by a browser gesture stranded global listeners. Every
//     listener here lives in an `ember-modifier` and is removed in its
//     destructor, and `pointercancel` restores the original order.
//   • **Stable ids, never array indices.** All four corpus implementations
//     keyed on array index, so any reorder or async refresh mid-interaction
//     targeted the wrong row. Every operation here takes a `LayerNode.id`.
//   • **Drop state is not colour-only.** The grabbed row carries a raised
//     shadow, `aria-pressed` on its handle, and a live-region sentence.
//   • **Inherited state is modelled.** A child of a hidden group IS hidden,
//     and its own toggle says so ("hidden by Cover art") instead of
//     reporting a flag that has no effect. No panel in the corpus did this.
//   • **A treegrid, not a tree.** A `role='treeitem'` is ONE tab stop, so a
//     tree with per-row buttons either buries them or breaks the pattern.
//     The APG's answer is `treegrid`: rows of cells, arrows between cells,
//     and every per-row control reachable without leaving the composite.
//
// Realm laws: no timers, no `Date.now`, no `Math.random`, no side-effect CSS
// imports, unnamed container queries only, no `.dark`, every colour a token
// with a light fallback. The pure functions at the top take no DOM and are
// unit-tested in `design-layers.test.gts`.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { guidFor } from '@ember/object/internals';
import { modifier } from 'ember-modifier';

import { focusWhen, listen, rovingTabindex } from '../focus';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';
import { EmptyState } from './empty-state';

// ═══════════════════════════════════════════════════════════════════════
// The model — pure. No DOM below this line until the modifier.
// ═══════════════════════════════════════════════════════════════════════

/** One layer. `children` is what makes it a group; everything else is flat. */
export interface LayerNode {
  /** Stable identity. Every operation in this file takes one of these and
   * never an array index — the defect all four corpus implementations
   * shared. */
  id: string;
  /** The name shown, and the root of every announcement. */
  name: string;
  /** Free-form kind — `'frame'`, `'group'`, `'text'`, `'image'`, `'shape'`,
   * `'component'`, `'mask'`. Drives the row glyph and the spoken kind word;
   * an unknown kind falls back to a neutral mark rather than nothing. */
  kind?: string;
  /** This layer's OWN visibility flag. An ancestor's flag can override the
   * effect without changing this value — see `LayerRow.inheritedHidden`. */
  hidden?: boolean;
  /** This layer's OWN lock flag, on the same terms. */
  locked?: boolean;
  /** Children, front-to-back, matching the panel's top-to-bottom order. */
  children?: readonly LayerNode[];
}

/** One VISIBLE row of the flattened tree, with everything ARIA and the
 * keyboard need precomputed. */
export interface LayerRow {
  node: LayerNode;
  id: string;
  name: string;
  /** 1-based, straight into `aria-level`. */
  level: number;
  /** 1-based position among its siblings, straight into `aria-posinset`. */
  posinset: number;
  setsize: number;
  parentId: string | undefined;
  parentName: string | undefined;
  hasChildren: boolean;
  expanded: boolean;
  /** the node's own flags */
  hidden: boolean;
  locked: boolean;
  /** an ancestor's flag is doing the work */
  inheritedHidden: boolean;
  inheritedLocked: boolean;
  /** what the reader actually sees on the canvas */
  effectiveHidden: boolean;
  effectiveLocked: boolean;
  glyph: string;
  kindWord: string;
}

/** A text mark per kind. Text, so it survives greyscale and a still frame —
 * Law 8 — and so a `role`-bearing ancestor never trips realm lint's
 * `require-presentational-children` on an `<svg>`. */
const KIND_GLYPH: Readonly<Record<string, string>> = {
  frame: '▢',
  group: '▤',
  text: 'T',
  image: '▣',
  shape: '◆',
  component: '◈',
  mask: '◐',
  vector: '✎',
};

const KIND_WORD: Readonly<Record<string, string>> = {
  frame: 'frame',
  group: 'group',
  text: 'text',
  image: 'image',
  shape: 'shape',
  component: 'component',
  mask: 'mask',
  vector: 'vector',
};

const DEFAULT_GLYPH = '·';

export function layerGlyph(kind: string | undefined): string {
  return (kind && KIND_GLYPH[kind]) || DEFAULT_GLYPH;
}

export function layerKindWord(kind: string | undefined): string {
  return (kind && KIND_WORD[kind]) || 'layer';
}

/**
 * Flatten the tree to the rows a reader can actually see, resolving
 * inherited visibility and lock on the way down.
 *
 * The inheritance is the part worth having. A layers panel that shows a
 * child's own `hidden: false` while its parent group is hidden is reporting
 * a flag that has no effect on anything — the reader looks at the canvas,
 * sees nothing, and looks at the panel, which says the layer is visible.
 * Resolving it here means the row, the toggle's accessible name and the
 * announcement all agree.
 */
export function flattenLayers(
  nodes: readonly LayerNode[],
  expanded: ReadonlySet<string>,
): LayerRow[] {
  const out: LayerRow[] = [];
  const walk = (
    list: readonly LayerNode[],
    level: number,
    parent: LayerNode | undefined,
    hiddenAbove: boolean,
    lockedAbove: boolean,
  ): void => {
    list.forEach((node, index) => {
      const hidden = node.hidden ?? false;
      const locked = node.locked ?? false;
      const hasChildren = (node.children?.length ?? 0) > 0;
      const isOpen = hasChildren && expanded.has(node.id);
      out.push({
        node,
        id: node.id,
        name: node.name,
        level,
        posinset: index + 1,
        setsize: list.length,
        parentId: parent?.id,
        parentName: parent?.name,
        hasChildren,
        expanded: isOpen,
        hidden,
        locked,
        inheritedHidden: hiddenAbove,
        inheritedLocked: lockedAbove,
        effectiveHidden: hidden || hiddenAbove,
        effectiveLocked: locked || lockedAbove,
        glyph: layerGlyph(node.kind),
        kindWord: layerKindWord(node.kind),
      });
      if (isOpen && node.children) {
        walk(
          node.children,
          level + 1,
          node,
          hiddenAbove || hidden,
          lockedAbove || locked,
        );
      }
    });
  };
  walk(nodes, 1, undefined, false, false);
  return out;
}

/** Every id in the tree, in flattened order, ignoring expansion. Used for
 * "expand all" and for validating a caller's selection. */
export function allLayerIds(nodes: readonly LayerNode[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly LayerNode[]): void => {
    for (const node of list) {
      out.push(node.id);
      if (node.children) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return out;
}

/** Ids of every branch, so a caller can open the whole tree without knowing
 * its shape. */
export function branchLayerIds(nodes: readonly LayerNode[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly LayerNode[]): void => {
    for (const node of list) {
      if ((node.children?.length ?? 0) > 0) {
        out.push(node.id);
        walk(node.children as readonly LayerNode[]);
      }
    }
  };
  walk(nodes);
  return out;
}

/** A structural clone with every array fresh, so a mutation below can never
 * reach the tree a caller handed in. Mutating a caller's array is the bug
 * that makes a Glimmer consumer stop re-rendering. */
function cloneLayers(nodes: readonly LayerNode[]): LayerNode[] {
  return nodes.map((node) =>
    node.children
      ? { ...node, children: cloneLayers(node.children) }
      : { ...node },
  );
}

/** One step of the path to a node: the array it lives in and where. */
interface LayerSite {
  list: LayerNode[];
  index: number;
}

/** The chain from the root array down to the node's own site, or
 * `undefined` when the id is not in the tree. */
function locateLayer(
  root: LayerNode[],
  id: string,
): LayerSite[] | undefined {
  const walk = (list: LayerNode[], trail: LayerSite[]): LayerSite[] | undefined => {
    for (let index = 0; index < list.length; index++) {
      const node = list[index];
      const here = trail.concat([{ list, index }]);
      if (node.id === id) {
        return here;
      }
      if (node.children) {
        const kids = node.children as LayerNode[];
        const found = walk(kids, here);
        if (found) {
          return found;
        }
      }
    }
    return undefined;
  };
  return walk(root, []);
}

export type LayerMoveIntent = 'raise' | 'lower' | 'indent' | 'outdent';

/** Where a layer ended up, in the words an announcement needs. */
export interface LayerMoveResult {
  /** false when the move was impossible — already first, already at the
   * root, no previous sibling to nest into. The tree comes back unchanged
   * and the caller says so out loud rather than doing nothing silently. */
  moved: boolean;
  tree: LayerNode[];
  level: number;
  position: number;
  setsize: number;
  parentName: string | undefined;
}

function describeLayer(tree: LayerNode[], id: string): Omit<LayerMoveResult, 'moved' | 'tree'> {
  const chain = locateLayer(tree, id);
  if (!chain || chain.length === 0) {
    return { level: 1, position: 1, setsize: 1, parentName: undefined };
  }
  const site = chain[chain.length - 1];
  const parent =
    chain.length > 1
      ? chain[chain.length - 2].list[chain[chain.length - 2].index]
      : undefined;
  return {
    level: chain.length,
    position: site.index + 1,
    setsize: site.list.length,
    parentName: parent?.name,
  };
}

/**
 * Move one layer by one step, returning a NEW tree.
 *
 * The four intents are complete — every position in any tree is reachable by
 * a sequence of them — and every one of them is visually continuous, so the
 * row lands next to where it left rather than teleporting. That is what
 * makes them announceable, and it is why the keyboard and the pointer can
 * share them.
 */
export function moveLayer(
  nodes: readonly LayerNode[],
  id: string,
  intent: LayerMoveIntent,
): LayerMoveResult {
  const tree = cloneLayers(nodes);
  const blocked = (): LayerMoveResult => ({
    moved: false,
    tree: cloneLayers(nodes),
    ...describeLayer(tree, id),
  });

  const chain = locateLayer(tree, id);
  if (!chain || chain.length === 0) {
    return blocked();
  }
  const site = chain[chain.length - 1];
  const node = site.list[site.index];

  if (intent === 'raise' || intent === 'lower') {
    const target = site.index + (intent === 'raise' ? -1 : 1);
    if (target < 0 || target >= site.list.length) {
      return blocked();
    }
    site.list[site.index] = site.list[target];
    site.list[target] = node;
  } else if (intent === 'indent') {
    // Into the layer directly above it, at the END of that layer's children:
    // adjacent to where it was standing, which is the only landing spot that
    // does not make the row appear to jump.
    if (site.index === 0) {
      return blocked();
    }
    const host = site.list[site.index - 1];
    site.list.splice(site.index, 1);
    host.children = ((host.children as LayerNode[] | undefined) ?? []).concat([
      node,
    ]);
  } else {
    // Out to just after its parent — again adjacent.
    if (chain.length < 2) {
      return blocked();
    }
    const parentSite = chain[chain.length - 2];
    site.list.splice(site.index, 1);
    parentSite.list.splice(parentSite.index + 1, 0, node);
  }

  return { moved: true, tree, ...describeLayer(tree, id) };
}

/** Set one boolean flag on one layer, returning a NEW tree. The panel never
 * mutates what it was given, so a caller holding the same array elsewhere is
 * never surprised. */
export function setLayerFlag(
  nodes: readonly LayerNode[],
  id: string,
  flagName: 'hidden' | 'locked',
  value: boolean,
): LayerNode[] {
  const tree = cloneLayers(nodes);
  const chain = locateLayer(tree, id);
  if (!chain || chain.length === 0) {
    return tree;
  }
  const site = chain[chain.length - 1];
  site.list[site.index] = { ...site.list[site.index], [flagName]: value };
  return tree;
}

export type LayerPhase = 'grab' | 'move' | 'blocked' | 'drop' | 'cancel';

/**
 * What the live region says.
 *
 * Exported and pure because it is the part of this component a sighted
 * reviewer never sees, and therefore the part most likely to be wrong; and
 * because a host rendering its own status should use these words rather than
 * invent a second vocabulary. Positions and levels are 1-based — screen
 * reader copy counts from one, always.
 */
export function layerAnnouncement(
  phase: LayerPhase,
  name: string,
  level: number,
  position: number,
  setsize: number,
  parentName?: string,
): string {
  const inside = parentName ? ', inside ' + parentName : ', at the top level';
  const place =
    'level ' + level + ', position ' + position + ' of ' + setsize + inside;
  switch (phase) {
    case 'grab':
      return (
        name +
        ' grabbed, ' +
        place +
        '. Up and down to reorder, right to nest it inside the layer above, left to move it out, Enter to drop, Escape to cancel.'
      );
    case 'move':
      return name + ', ' + place + '.';
    case 'blocked':
      return name + ' cannot move any further that way. Still ' + place + '.';
    case 'drop':
      return name + ' dropped at ' + place + '.';
    case 'cancel':
      return 'Move cancelled. ' + name + ' returned to ' + place + '.';
  }
}

// ═══════════════════════════════════════════════════════════════════════
// The pointer half — one rect read, once
// ═══════════════════════════════════════════════════════════════════════

/** What `layerDrag` needs from the component. Kept as an interface so the
 * modifier and the component cannot drift. */
export interface LayerDragHost {
  /** px of horizontal travel that counts as one nesting step */
  indentStep: number;
  grabByPointer: (id: string) => void;
  stepByPointer: (intent: LayerMoveIntent) => void;
  dropMove: () => void;
  cancelMove: () => void;
}

/**
 * Drag a layer with the pointer, mapped onto exactly the same four
 * operations the keyboard drives.
 *
 * Vertical travel is raise/lower, horizontal travel is outdent/indent. That
 * mapping is what makes the pointer path free: there is no hit-testing, no
 * `elementFromPoint`, no per-tile `getBoundingClientRect` — ONE rect is read
 * at pointerdown to learn the row height, and every step after that is
 * arithmetic on pointer deltas. The corpus implementations this replaces did
 * two forced synchronous layouts on every single `pointermove`.
 *
 * Installed on the HANDLE rather than on the list, deliberately: the kit's
 * shared `dragsSurface` `preventDefault()`s every primary press inside the
 * surface it owns, which would make the visibility and lock buttons in every
 * row unfocusable by pointer. A layers panel is a list whose rows are FULL
 * of controls, so the shared surface modifier is the wrong shape here and
 * the limitation is named rather than worked around.
 */
export const layerDrag = modifier(
  (
    el: HTMLElement,
    [host, id, disabled]: [LayerDragHost, string, boolean | undefined],
  ) => {
    let pointerId: number | undefined;
    let anchorX = 0;
    let anchorY = 0;
    let rowHeight = 24;

    const release = (): void => {
      if (pointerId !== undefined && el.hasPointerCapture(pointerId)) {
        el.releasePointerCapture(pointerId);
      }
      pointerId = undefined;
    };

    const down = (event: Event): void => {
      const pointer = event as PointerEvent;
      if (disabled || pointer.button !== 0 || pointerId !== undefined) {
        return;
      }
      pointer.preventDefault();
      pointerId = pointer.pointerId;
      el.setPointerCapture(pointerId);
      anchorX = pointer.clientX;
      anchorY = pointer.clientY;
      // THE one layout read of the whole gesture.
      const row = el.closest('[data-layer-row]');
      rowHeight = row ? Math.max(12, row.getBoundingClientRect().height) : 24;
      // dragsSurface's lesson, applied: preventDefault suppresses the
      // browser's focus-on-press, so focus is restored by hand and the
      // gesture can always be finished from the keyboard.
      el.focus();
      host.grabByPointer(id);
    };

    const move = (event: Event): void => {
      const pointer = event as PointerEvent;
      if (pointerId === undefined || pointer.pointerId !== pointerId) {
        return;
      }
      const dy = pointer.clientY - anchorY;
      const dx = pointer.clientX - anchorX;
      // Vertical wins ties: reordering is the common intent, and a diagonal
      // drag that re-nested on the way past would be unusable.
      if (Math.abs(dy) >= rowHeight) {
        host.stepByPointer(dy > 0 ? 'lower' : 'raise');
        // Re-anchor on every threshold crossing, applied or blocked. The row
        // has moved under the pointer by exactly one row, so the pointer's
        // current position IS the new origin — and a blocked direction
        // therefore never accrues a debt that snaps back later.
        anchorY = pointer.clientY;
        anchorX = pointer.clientX;
      } else if (Math.abs(dx) >= host.indentStep) {
        host.stepByPointer(dx > 0 ? 'indent' : 'outdent');
        anchorX = pointer.clientX;
      }
    };

    const up = (event: Event): void => {
      const pointer = event as PointerEvent;
      if (pointerId === undefined || pointer.pointerId !== pointerId) {
        return;
      }
      release();
      host.dropMove();
    };

    // The handler the corpus forgot. A drag interrupted by a browser gesture
    // — a back-swipe, a context menu, a window drag — fires pointercancel
    // and NOT pointerup, so without this the row stays grabbed forever and
    // the listeners stay attached.
    const abort = (event: Event): void => {
      const pointer = event as PointerEvent;
      if (pointerId === undefined || pointer.pointerId !== pointerId) {
        return;
      }
      release();
      host.cancelMove();
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', abort);

    return () => {
      release();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', abort);
    };
  },
);

// ═══════════════════════════════════════════════════════════════════════
// LayerManager
// ═══════════════════════════════════════════════════════════════════════

export type LayerSelectionMode = 'none' | 'single' | 'multi';

/** Which cells a row carries, left to right. The name cell is not optional
 * — a row without a name is not a row. */
type LayerColumn = 'handle' | 'name' | 'hidden' | 'locked';

/** One rendered row: `LayerRow` plus everything the template needs, so the
 * template itself stays declarative. */
interface RenderRow extends LayerRow {
  selected: boolean;
  grabbed: boolean;
  expandedAttr: 'true' | 'false' | undefined;
  selectedAttr: 'true' | 'false';
  grabbedAttr: 'true' | 'false';
  indentStyle: ReturnType<typeof cssStyleFrom>;
  handleLabel: string;
  hiddenLabel: string;
  lockedLabel: string;
  hiddenPressed: 'true' | 'false';
  lockedPressed: 'true' | 'false';
  /** A word beside the name whenever state is on, so the row still reads in
   * greyscale and in a screenshot — never an icon tint alone. */
  stateWord: string;
}

export interface LayerManagerSignature {
  Args: {
    /** Controlled tree, front-to-back (the top row is the front-most layer,
     * as in every design tool). Omit for the uncontrolled case. */
    layers?: readonly LayerNode[];
    /** Initial tree when uncontrolled. */
    defaultLayers?: readonly LayerNode[];
    /** Fires with the NEXT WHOLE TREE after any structural change — a move,
     * a visibility flip, a lock flip. One channel, so a host can store the
     * result without reassembling it from deltas. */
    onLayersChange?: (next: LayerNode[]) => void;

    /** Controlled expansion, as ids. */
    expanded?: readonly string[];
    /** Initial expansion when uncontrolled. */
    defaultExpanded?: readonly string[];
    onExpandedChange?: (ids: string[]) => void;

    /** `'single'` (default), `'multi'` or `'none'`. */
    selectionMode?: LayerSelectionMode;
    /** Controlled selection, as ids. */
    selected?: readonly string[];
    /** Initial selection when uncontrolled. */
    defaultSelected?: readonly string[];
    onSelectionChange?: (ids: string[], nodes: LayerNode[]) => void;

    /** The delta, for hosts that want it narrower than the whole tree. */
    onVisibilityChange?: (node: LayerNode, hidden: boolean) => void;
    onLockChange?: (node: LayerNode, locked: boolean) => void;
    /** Double-click, or Enter on the name cell — "open this layer". */
    onActivate?: (node: LayerNode) => void;

    /** Accessible name for the grid. @default 'Layers' */
    label?: string;
    /** px of indent per nesting level. Also `--pretui-lm-indent`. @default 14 */
    indent?: number;
    /** Row height preset: `'compact'` or `'comfortable'` (default). */
    density?: 'compact' | 'comfortable';
    /** Offer the grab handle and the whole move contract. @default true */
    reorderable?: boolean;
    /** Offer the visibility toggle. @default true */
    showVisibility?: boolean;
    /** Offer the lock toggle. @default true */
    showLock?: boolean;
    /** Dimmed; nothing moves and nothing toggles. Rows stay focusable and
     * readable, because a disabled panel is still information. */
    disabled?: boolean;
  };
  Blocks: {
    /** Replaces the name cell's contents; receives the row. */
    name: [LayerRow];
    /** Extra cells' worth of trailing content inside the name cell —
     * a blend-mode chip, an opacity readout. Keep focusable controls OUT of
     * it: the row is a grid and a stray tab stop breaks the composite. */
    trailing: [LayerRow];
    /** Replaces the default empty state. */
    empty: [];
  };
  Element: HTMLDivElement;
}

export class LayerManager
  extends Component<LayerManagerSignature>
  implements LayerDragHost
{
  private guid = guidFor(this);

  // ── state ──────────────────────────────────────────────────────────────

  @tracked private ownLayers: LayerNode[] | undefined = undefined;
  @tracked private ownExpanded: string[] | undefined = undefined;
  @tracked private ownSelected: string[] | undefined = undefined;

  /** The in-flight tree while a move is happening. `undefined` means "the
   * order is exactly what the caller gave us". Holding it separately is what
   * lets Escape restore the original without the caller ever having been
   * told about the intermediate steps. */
  @tracked private working: LayerNode[] | undefined = undefined;
  /** The tree as it stood when the grab began, so cancel is exact. */
  private beforeGrab: LayerNode[] | undefined = undefined;
  @tracked private grabbedId: string | undefined = undefined;

  /** The keyboard cursor: which row, and which column within it. */
  @tracked private cursorId: string | undefined = undefined;
  @tracked private cursorCol = 0;
  /** True only while the keyboard is driving, so `focusWhen` never steals
   * focus on a plain re-render or during a pointer gesture. */
  @tracked private navigating = false;
  /** Where a Shift-range starts — held apart from the cursor so a range
   * extends from where the reader began. */
  @tracked private anchorId: string | undefined = undefined;

  @tracked private announcement = '';

  // ── derived config ─────────────────────────────────────────────────────

  get label(): string {
    return this.args.label ?? 'Layers';
  }
  get hintId(): string {
    return this.guid + '-lm-hint';
  }
  get density(): 'compact' | 'comfortable' {
    return this.args.density === 'compact' ? 'compact' : 'comfortable';
  }
  get reorderable(): boolean {
    return (this.args.reorderable ?? true) && !this.args.disabled;
  }
  get showVisibility(): boolean {
    return this.args.showVisibility ?? true;
  }
  get showLock(): boolean {
    return this.args.showLock ?? true;
  }
  get mode(): LayerSelectionMode {
    return this.args.selectionMode ?? 'single';
  }
  get multi(): boolean {
    return this.mode === 'multi';
  }
  get multiAttr(): 'true' | undefined {
    return this.multi ? 'true' : undefined;
  }
  get indentStep(): number {
    return Math.max(4, Math.round(this.args.indent ?? 14));
  }

  get columns(): LayerColumn[] {
    const out: LayerColumn[] = [];
    if (this.reorderable) {
      out.push('handle');
    }
    out.push('name');
    if (this.showVisibility) {
      out.push('hidden');
    }
    if (this.showLock) {
      out.push('locked');
    }
    return out;
  }
  get colCount(): number {
    return this.columns.length;
  }
  private colIndex(column: LayerColumn): number {
    return this.columns.indexOf(column);
  }
  get handleCol(): number {
    return this.colIndex('handle');
  }
  get nameCol(): number {
    return this.colIndex('name');
  }
  get hiddenCol(): number {
    return this.colIndex('hidden');
  }
  get lockedCol(): number {
    return this.colIndex('locked');
  }
  /** `aria-colindex` is 1-based; the internal cursor is not. */
  get handleAria(): number {
    return this.handleCol + 1;
  }
  get nameAria(): number {
    return this.nameCol + 1;
  }
  get hiddenAria(): number {
    return this.hiddenCol + 1;
  }
  get lockedAria(): number {
    return this.lockedCol + 1;
  }

  get hostStyle() {
    return cssStyleFrom([
      cssDeclaration('--pretui-lm-indent', this.indentStep + 'px'),
    ]);
  }

  // ── derived data ───────────────────────────────────────────────────────

  get layers(): readonly LayerNode[] {
    if (this.working) {
      return this.working;
    }
    if (this.args.layers !== undefined) {
      return this.args.layers;
    }
    if (this.ownLayers !== undefined) {
      return this.ownLayers;
    }
    return this.args.defaultLayers ?? [];
  }

  get expandedSet(): ReadonlySet<string> {
    const ids =
      this.args.expanded ??
      this.ownExpanded ??
      this.args.defaultExpanded ??
      branchLayerIds(this.layers);
    return new Set(ids);
  }

  get selectedIds(): readonly string[] {
    if (this.mode === 'none') {
      return [];
    }
    return (
      this.args.selected ?? this.ownSelected ?? this.args.defaultSelected ?? []
    );
  }

  get baseRows(): LayerRow[] {
    return flattenLayers(this.layers, this.expandedSet);
  }
  get hasRows(): boolean {
    return this.baseRows.length > 0;
  }
  get rowCount(): number {
    return this.baseRows.length;
  }

  /** The cursor row id, defaulted to the first row so there is always
   * exactly one tab stop — never zero, never two. */
  get cursorRowId(): string | undefined {
    const rows = this.baseRows;
    if (rows.length === 0) {
      return undefined;
    }
    const wanted = this.cursorId;
    if (wanted && rows.some((row) => row.id === wanted)) {
      return wanted;
    }
    return rows[0].id;
  }

  /** The cursor column, clamped to the columns that actually exist — so
   * turning `@showLock` off cannot strand the tab stop on a cell that is no
   * longer rendered. */
  get cursorColumn(): number {
    return Math.max(0, Math.min(this.colCount - 1, this.cursorCol));
  }

  get rows(): RenderRow[] {
    const chosen = new Set(this.selectedIds);
    return this.baseRows.map((row) => {
      const selected = chosen.has(row.id);
      const grabbed = this.grabbedId === row.id;
      const words: string[] = [];
      if (row.effectiveHidden) {
        words.push('hidden');
      }
      if (row.effectiveLocked) {
        words.push('locked');
      }
      return {
        ...row,
        selected,
        grabbed,
        expandedAttr: row.hasChildren
          ? row.expanded
            ? ('true' as const)
            : ('false' as const)
          : undefined,
        selectedAttr: selected ? ('true' as const) : ('false' as const),
        grabbedAttr: grabbed ? ('true' as const) : ('false' as const),
        indentStyle: cssStyleFrom([
          cssDeclaration('--pretui-lm-level', String(row.level - 1)),
        ]),
        handleLabel: this.handleNameFor(row, grabbed),
        hiddenLabel: this.visibilityNameFor(row),
        lockedLabel: this.lockNameFor(row),
        hiddenPressed: row.hidden ? ('true' as const) : ('false' as const),
        lockedPressed: row.locked ? ('true' as const) : ('false' as const),
        stateWord: words.join(' · '),
      };
    });
  }

  private placeOf(row: LayerRow): string {
    return (
      'level ' +
      row.level +
      ', position ' +
      row.posinset +
      ' of ' +
      row.setsize
    );
  }

  private handleNameFor(row: LayerRow, grabbed: boolean): string {
    return (
      (grabbed ? 'Moving ' : 'Move ') +
      row.name +
      ', ' +
      row.kindWord +
      ', ' +
      this.placeOf(row)
    );
  }

  /** The accessible name says what the button DOES and what is currently
   * true, including when an ancestor is the reason. A toggle that reports a
   * flag with no effect is the defect this fixes. */
  private visibilityNameFor(row: LayerRow): string {
    if (row.inheritedHidden && !row.hidden) {
      return 'Show ' + row.name + ' — hidden by ' + (row.parentName ?? 'a group');
    }
    return (row.hidden ? 'Show ' : 'Hide ') + row.name;
  }

  private lockNameFor(row: LayerRow): string {
    if (row.inheritedLocked && !row.locked) {
      return 'Unlock ' + row.name + ' — locked by ' + (row.parentName ?? 'a group');
    }
    return (row.locked ? 'Unlock ' : 'Lock ') + row.name;
  }

  isCursor = (row: RenderRow, column: number): boolean => {
    return row.id === this.cursorRowId && column === this.cursorColumn;
  };
  takesFocus = (row: RenderRow, column: number): boolean => {
    return this.navigating && this.isCursor(row, column);
  };

  // ── writes ─────────────────────────────────────────────────────────────

  private publishLayers(next: LayerNode[]): void {
    if (this.args.layers === undefined) {
      this.ownLayers = next;
    }
    this.args.onLayersChange?.(next);
  }

  private publishExpanded(ids: string[]): void {
    if (this.args.expanded === undefined) {
      this.ownExpanded = ids;
    }
    this.args.onExpandedChange?.(ids);
  }

  private publishSelection(ids: string[]): void {
    const order = this.baseRows.map((row) => row.id);
    const unique = Array.from(new Set(ids)).sort(
      (a, b) => order.indexOf(a) - order.indexOf(b),
    );
    if (this.args.selected === undefined) {
      this.ownSelected = unique;
    }
    const byId = new Map(this.baseRows.map((row) => [row.id, row.node]));
    this.args.onSelectionChange?.(
      unique,
      unique.map((id) => byId.get(id)).filter((n): n is LayerNode => !!n),
    );
  }

  private moveCursor(id: string, column: number, keyboard: boolean): void {
    this.cursorId = id;
    this.cursorCol = Math.max(0, Math.min(this.colCount - 1, column));
    this.navigating = keyboard;
  }

  private toggleExpanded(id: string): void {
    const next = new Set(this.expandedSet);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.publishExpanded(Array.from(next));
  }

  private selectOnly(id: string): void {
    if (this.mode === 'none') {
      return;
    }
    this.anchorId = id;
    this.publishSelection([id]);
  }

  private toggleSelected(id: string): void {
    if (this.mode === 'none') {
      return;
    }
    if (!this.multi) {
      this.selectOnly(id);
      return;
    }
    this.anchorId = id;
    const current = this.selectedIds.slice();
    const at = current.indexOf(id);
    if (at === -1) {
      current.push(id);
    } else {
      current.splice(at, 1);
    }
    this.publishSelection(current);
  }

  private extendSelection(id: string): void {
    if (!this.multi) {
      this.selectOnly(id);
      return;
    }
    const order = this.baseRows.map((row) => row.id);
    const from = this.anchorId ? order.indexOf(this.anchorId) : -1;
    const to = order.indexOf(id);
    if (from === -1 || to === -1) {
      this.selectOnly(id);
      return;
    }
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    this.publishSelection(order.slice(lo, hi + 1));
  }

  private flipFlag(row: LayerRow, flagName: 'hidden' | 'locked'): void {
    if (this.args.disabled) {
      return;
    }
    const value = !(flagName === 'hidden' ? row.hidden : row.locked);
    const next = setLayerFlag(this.layers, row.id, flagName, value);
    this.publishLayers(next);
    if (flagName === 'hidden') {
      this.args.onVisibilityChange?.(row.node, value);
    } else {
      this.args.onLockChange?.(row.node, value);
    }
  }

  // ── the move contract, shared by keyboard and pointer ──────────────────

  private rowById(id: string): LayerRow | undefined {
    return this.baseRows.find((row) => row.id === id);
  }

  private say(
    phase: LayerPhase,
    name: string,
    level: number,
    position: number,
    setsize: number,
    parentName: string | undefined,
  ): void {
    this.announcement = layerAnnouncement(
      phase,
      name,
      level,
      position,
      setsize,
      parentName,
    );
  }

  private beginMove(id: string): void {
    if (!this.reorderable || this.grabbedId !== undefined) {
      return;
    }
    const row = this.rowById(id);
    if (!row) {
      return;
    }
    this.beforeGrab = cloneLayers(this.layers);
    this.working = cloneLayers(this.layers);
    this.grabbedId = id;
    this.say('grab', row.name, row.level, row.posinset, row.setsize, row.parentName);
  }

  private stepMove(intent: LayerMoveIntent): void {
    const id = this.grabbedId;
    if (id === undefined) {
      return;
    }
    const before = this.rowById(id);
    const result = moveLayer(this.layers, id, intent);
    this.working = result.tree;
    const name = before?.name ?? '';
    this.say(
      result.moved ? 'move' : 'blocked',
      name,
      result.level,
      result.position,
      result.setsize,
      result.parentName,
    );
    // Nesting can move a row into a collapsed parent, which would make the
    // thing being dragged vanish. Opening it is not a courtesy, it is a
    // correctness fix.
    if (result.moved && intent === 'indent') {
      const landed = flattenLayers(result.tree, this.expandedSet).some(
        (row) => row.id === id,
      );
      if (!landed) {
        const chain = locateLayer(result.tree, id);
        if (chain && chain.length > 1) {
          const parentSite = chain[chain.length - 2];
          const parent = parentSite.list[parentSite.index];
          const next = new Set(this.expandedSet);
          next.add(parent.id);
          this.publishExpanded(Array.from(next));
        }
      }
    }
  }

  private endMove(commit: boolean): void {
    const id = this.grabbedId;
    if (id === undefined) {
      return;
    }
    const tree = (commit ? this.working : this.beforeGrab) ?? cloneLayers(this.layers);
    const name = this.rowById(id)?.name ?? '';
    // The landing place is read from the SETTLED tree by the same pure
    // function the move used, never by round-tripping through tracked state
    // — writing `working` and reading it back in one handler is exactly the
    // backtracking shape the kit has paid for before.
    const place = describeLayer(tree, id);
    this.grabbedId = undefined;
    this.working = undefined;
    this.beforeGrab = undefined;
    this.say(
      commit ? 'drop' : 'cancel',
      name,
      place.level,
      place.position,
      place.setsize,
      place.parentName,
    );
    this.publishLayers(tree);
  }

  // LayerDragHost — the pointer path calls the SAME three entry points the
  // keyboard does, which is why they cannot drift apart.
  grabByPointer = (id: string): void => {
    this.navigating = false;
    this.moveCursor(id, this.handleCol, false);
    this.beginMove(id);
  };
  stepByPointer = (intent: LayerMoveIntent): void => {
    this.stepMove(intent);
  };
  dropMove = (): void => {
    this.endMove(true);
  };
  cancelMove = (): void => {
    this.endMove(false);
  };

  // ── pointer, delegated ─────────────────────────────────────────────────

  private cellFrom(event: Event): { id: string; col: number } | undefined {
    const target = event.target;
    if (!(target instanceof Element)) {
      return undefined;
    }
    const cell = target.closest('[data-layer-cell]');
    if (!(cell instanceof HTMLElement)) {
      return undefined;
    }
    const id = cell.getAttribute('data-layer-id');
    const col = Number.parseInt(cell.getAttribute('data-col') ?? '', 10);
    if (!id || Number.isNaN(col)) {
      return undefined;
    }
    return { id, col };
  }

  onGridClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const twisty = target.closest('[data-layer-twisty]');
    if (twisty instanceof HTMLElement) {
      const id = twisty.getAttribute('data-layer-id');
      if (id) {
        this.toggleExpanded(id);
      }
      return;
    }

    const toggle = target.closest('[data-layer-toggle]');
    if (toggle instanceof HTMLElement) {
      const id = toggle.getAttribute('data-layer-id');
      const flagName = toggle.getAttribute('data-layer-flag');
      const row = id ? this.rowById(id) : undefined;
      if (row && (flagName === 'hidden' || flagName === 'locked')) {
        this.moveCursor(
          row.id,
          flagName === 'hidden' ? this.hiddenCol : this.lockedCol,
          false,
        );
        this.flipFlag(row, flagName);
      }
      return;
    }

    const cell = this.cellFrom(event);
    if (!cell) {
      return;
    }
    this.moveCursor(cell.id, cell.col, false);
    const mouse = event as MouseEvent;
    if (mouse.shiftKey) {
      this.extendSelection(cell.id);
    } else if (mouse.metaKey || mouse.ctrlKey) {
      this.toggleSelected(cell.id);
    } else {
      this.selectOnly(cell.id);
    }
  };

  onGridDblClick = (event: Event): void => {
    const cell = this.cellFrom(event);
    const row = cell ? this.rowById(cell.id) : undefined;
    if (row) {
      this.args.onActivate?.(row.node);
    }
  };

  // ── keyboard ───────────────────────────────────────────────────────────

  onGridKeydown = (raw: Event): void => {
    const event = raw as KeyboardEvent;
    const cell = this.cellFrom(event);
    if (!cell) {
      return;
    }
    if (this.grabbedId !== undefined && cell.id === this.grabbedId) {
      this.moveKeys(event);
      return;
    }
    this.navigationKeys(event, cell.id, cell.col);
  };

  /** While a row is grabbed the arrows mean something else entirely, so the
   * two key maps are separate functions rather than one with a flag in the
   * middle — the shape a reviewer can check. */
  private moveKeys(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        this.stepMove('raise');
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.stepMove('lower');
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.stepMove('indent');
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.stepMove('outdent');
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.endMove(true);
        break;
      case 'Escape':
        event.preventDefault();
        this.endMove(false);
        break;
      case 'Tab':
        // Leaving with a row still in the air would strand it. Drop first,
        // then let the browser move focus normally.
        this.endMove(true);
        break;
      default:
        break;
    }
  }

  private navigationKeys(
    event: KeyboardEvent,
    id: string,
    col: number,
  ): void {
    const rows = this.baseRows;
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) {
      return;
    }
    const row = rows[index];
    const last = rows.length - 1;
    const lastCol = this.colCount - 1;

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const next = rows[Math.min(last, index + 1)];
        this.moveCursor(next.id, col, true);
        if (event.shiftKey) {
          this.extendSelection(next.id);
        }
        return;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const next = rows[Math.max(0, index - 1)];
        this.moveCursor(next.id, col, true);
        if (event.shiftKey) {
          this.extendSelection(next.id);
        }
        return;
      }
      case 'ArrowRight': {
        event.preventDefault();
        // The treegrid rule: on the row's first cell a collapsed branch
        // opens; everywhere else the cursor walks right through the cells.
        if (col === 0 && row.hasChildren && !row.expanded) {
          this.toggleExpanded(row.id);
          return;
        }
        this.moveCursor(row.id, Math.min(lastCol, col + 1), true);
        return;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        if (col === 0) {
          if (row.hasChildren && row.expanded) {
            this.toggleExpanded(row.id);
            return;
          }
          if (row.parentId) {
            this.moveCursor(row.parentId, 0, true);
          }
          return;
        }
        this.moveCursor(row.id, Math.max(0, col - 1), true);
        return;
      }
      case 'Home':
        event.preventDefault();
        this.moveCursor(rows[0].id, col, true);
        return;
      case 'End':
        event.preventDefault();
        this.moveCursor(rows[last].id, col, true);
        return;
      case ' ': {
        event.preventDefault();
        // Space acts on whatever the cursor is in — the keyboard twin of
        // clicking that exact cell, which is the parity test.
        if (col === this.handleCol && this.reorderable) {
          this.beginMove(row.id);
        } else if (col === this.hiddenCol) {
          this.flipFlag(row, 'hidden');
        } else if (col === this.lockedCol) {
          this.flipFlag(row, 'locked');
        } else {
          this.toggleSelected(row.id);
        }
        return;
      }
      case 'Enter': {
        event.preventDefault();
        if (col === this.handleCol && this.reorderable) {
          this.beginMove(row.id);
        } else if (col === this.hiddenCol) {
          this.flipFlag(row, 'hidden');
        } else if (col === this.lockedCol) {
          this.flipFlag(row, 'locked');
        } else {
          this.selectOnly(row.id);
          this.args.onActivate?.(row.node);
        }
        return;
      }
      case 'a':
      case 'A':
        if ((event.metaKey || event.ctrlKey) && this.multi) {
          event.preventDefault();
          this.publishSelection(rows.map((visible) => visible.id));
        }
        return;
      case 'Escape':
        if (this.selectedIds.length > 0) {
          event.preventDefault();
          this.publishSelection([]);
        }
        return;
      default:
        return;
    }
  }

  <template>
    <div
      class='pretui-lm'
      data-density={{this.density}}
      data-disabled={{if @disabled 'true'}}
      style={{this.hostStyle}}
      data-test-pretui-layer-manager
      ...attributes
    >
      {{#if this.hasRows}}
        <div
          class='pretui-lm-grid'
          role='treegrid'
          aria-label={{this.label}}
          aria-multiselectable={{this.multiAttr}}
          aria-colcount={{this.colCount}}
          aria-rowcount={{this.rowCount}}
          aria-describedby={{this.hintId}}
          data-test-pretui-layer-grid
          {{listen 'click' this.onGridClick}}
          {{listen 'dblclick' this.onGridDblClick}}
          {{listen 'keydown' this.onGridKeydown}}
        >
          {{#each this.rows key='id' as |row|}}
            <div
              class='pretui-lm-row'
              role='row'
              data-layer-row
              data-layer-id={{row.id}}
              data-selected={{if row.selected 'true'}}
              data-grabbed={{if row.grabbed 'true'}}
              data-hidden={{if row.effectiveHidden 'true'}}
              data-locked={{if row.effectiveLocked 'true'}}
              data-branch={{if row.hasChildren 'true'}}
              aria-level={{row.level}}
              aria-posinset={{row.posinset}}
              aria-setsize={{row.setsize}}
              aria-expanded={{row.expandedAttr}}
              aria-selected={{row.selectedAttr}}
              data-test-pretui-layer-row
            >
              {{#if this.reorderable}}
                <div
                  class='pretui-lm-cell pretui-lm-cellGrab'
                  role='gridcell'
                  aria-colindex={{this.handleAria}}
                >
                  <button
                    type='button'
                    class='pretui-lm-handle'
                    data-layer-cell='handle'
                    data-layer-id={{row.id}}
                    data-col={{this.handleCol}}
                    data-test-pretui-layer-handle
                    aria-label={{row.handleLabel}}
                    aria-pressed={{row.grabbedAttr}}
                    {{rovingTabindex (this.isCursor row this.handleCol)}}
                    {{focusWhen (this.takesFocus row this.handleCol)}}
                    {{layerDrag this row.id @disabled}}
                  ><span class='pretui-lm-grip' aria-hidden='true'></span></button>
                </div>
              {{/if}}

              <div
                class='pretui-lm-cell pretui-lm-cellName'
                role='gridcell'
                aria-colindex={{this.nameAria}}
                data-layer-cell='name'
                data-layer-id={{row.id}}
                data-col={{this.nameCol}}
                style={{row.indentStyle}}
                data-test-pretui-layer-name
                {{rovingTabindex (this.isCursor row this.nameCol)}}
                {{focusWhen (this.takesFocus row this.nameCol)}}
              >
                <span
                  class='pretui-lm-twisty'
                  data-layer-twisty
                  data-layer-id={{row.id}}
                  data-open={{if row.expanded 'true'}}
                  data-leaf={{unless row.hasChildren 'true'}}
                  aria-hidden='true'
                ></span>
                <span class='pretui-lm-glyph' aria-hidden='true'>{{row.glyph}}</span>
                {{#if (has-block 'name')}}
                  {{yield row to='name'}}
                {{else}}
                  <span class='pretui-lm-text'>{{row.name}}</span>
                {{/if}}
                {{#if row.stateWord}}
                  {{!-- The word is the second channel. A dimmed row is a
                        colour, and a colour alone is never a state. --}}
                  <span class='pretui-lm-badge'>{{row.stateWord}}</span>
                {{/if}}
                {{#if (has-block 'trailing')}}
                  <span class='pretui-lm-trailing'>{{yield row to='trailing'}}</span>
                {{/if}}
              </div>

              {{#if this.showVisibility}}
                <div
                  class='pretui-lm-cell pretui-lm-cellFlag'
                  role='gridcell'
                  aria-colindex={{this.hiddenAria}}
                >
                  <button
                    type='button'
                    class='pretui-lm-toggle'
                    data-layer-cell='hidden'
                    data-layer-toggle
                    data-layer-flag='hidden'
                    data-layer-id={{row.id}}
                    data-col={{this.hiddenCol}}
                    data-inherited={{if row.inheritedHidden 'true'}}
                    data-test-pretui-layer-visibility
                    aria-label={{row.hiddenLabel}}
                    aria-pressed={{row.hiddenPressed}}
                    aria-disabled={{if @disabled 'true'}}
                    {{rovingTabindex (this.isCursor row this.hiddenCol)}}
                    {{focusWhen (this.takesFocus row this.hiddenCol)}}
                  ><span class='pretui-lm-eye' aria-hidden='true'></span></button>
                </div>
              {{/if}}

              {{#if this.showLock}}
                <div
                  class='pretui-lm-cell pretui-lm-cellFlag'
                  role='gridcell'
                  aria-colindex={{this.lockedAria}}
                >
                  <button
                    type='button'
                    class='pretui-lm-toggle'
                    data-layer-cell='locked'
                    data-layer-toggle
                    data-layer-flag='locked'
                    data-layer-id={{row.id}}
                    data-col={{this.lockedCol}}
                    data-inherited={{if row.inheritedLocked 'true'}}
                    data-test-pretui-layer-lock
                    aria-label={{row.lockedLabel}}
                    aria-pressed={{row.lockedPressed}}
                    aria-disabled={{if @disabled 'true'}}
                    {{rovingTabindex (this.isCursor row this.lockedCol)}}
                    {{focusWhen (this.takesFocus row this.lockedCol)}}
                  ><span class='pretui-lm-lock' aria-hidden='true'></span></button>
                </div>
              {{/if}}
            </div>
          {{/each}}
        </div>

        <p id={{this.hintId}} class='pretui-lm-hint'>Arrow keys move between
          rows and cells. On a handle, press Enter or Space to pick a layer
          up, then up and down to reorder it, right to nest it inside the
          layer above, left to move it back out, Enter to drop and Escape to
          cancel.</p>
        <p
          class='pretui-lm-live'
          role='status'
          aria-live='polite'
          data-test-pretui-layer-status
        >{{this.announcement}}</p>
      {{else if (has-block 'empty')}}
        {{yield to='empty'}}
      {{else}}
        <EmptyState
          @title='No layers yet'
          @message='Draw something, or drop a file onto the canvas, and it will appear here.'
        />
      {{/if}}
    </div>

    <style scoped>
      .pretui-lm {
        --pretui-lm-indent: 14px;
        --pretui-lm-row-h: 26px;
        display: grid;
        gap: var(--space-2, 6px);
        min-width: 0;
      }
      .pretui-lm[data-density='compact'] {
        --pretui-lm-row-h: 22px;
      }
      .pretui-lm[data-disabled='true'] {
        opacity: 0.55;
      }

      .pretui-lm-grid {
        display: grid;
        min-width: 0;
      }
      .pretui-lm-row {
        --pretui-lm-level: 0;
        display: flex;
        align-items: center;
        gap: 2px;
        min-width: 0;
        height: var(--pretui-lm-row-h);
        border-radius: var(--radius-sm, 6px);
      }
      .pretui-lm-row:hover {
        background: var(
          --hover,
          color-mix(in oklch, var(--foreground) 5%, transparent)
        );
      }
      .pretui-lm-row[data-selected='true'] {
        background: color-mix(
          in oklch,
          var(--primary) 14%,
          var(--card)
        );
      }
      /* Law 5: the raised state encodes "this is the layer you are
         carrying" — a fact the reader would otherwise infer from rows
         shuffling. It rests in a still frame, so nothing depends on motion
         to be legible (Law 8). */
      .pretui-lm-row[data-grabbed='true'] {
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-raised,
          0 0 0 1px var(--border),
          0 2px 10px rgb(0 0 0 / 0.22)
        );
      }

      .pretui-lm-cell {
        display: flex;
        align-items: center;
        min-width: 0;
      }
      .pretui-lm-cell:focus-visible,
      .pretui-lm-handle:focus-visible,
      .pretui-lm-toggle:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: -1px;
        border-radius: var(--radius-sm, 6px);
      }
      .pretui-lm-cellName {
        flex: 1 1 auto;
        gap: 4px;
        /* min-width: 0 with the ellipsis below is the fix for the flex
           overflow that otherwise blows the row out on a long name
           (Appendix O.8). */
        min-width: 0;
        padding-inline-start: calc(
          var(--pretui-lm-indent, 14px) * var(--pretui-lm-level, 0)
        );
      }
      .pretui-lm-cellGrab,
      .pretui-lm-cellFlag {
        flex: 0 0 auto;
      }

      .pretui-lm-handle,
      .pretui-lm-toggle {
        display: grid;
        place-items: center;
        width: var(--pretui-lm-row-h);
        height: var(--pretui-lm-row-h);
        padding: 0;
        border: 0;
        background: none;
        color: var(--muted-foreground);
        cursor: pointer;
      }
      .pretui-lm-handle {
        cursor: grab;
        width: 16px;
      }
      .pretui-lm-row[data-grabbed='true'] .pretui-lm-handle {
        cursor: grabbing;
      }
      .pretui-lm-grip {
        width: 6px;
        height: 10px;
        background-image: radial-gradient(currentColor 40%, transparent 42%);
        background-size: 3px 3px;
        opacity: 0.75;
      }

      /* The twisty is a CSS triangle rather than a glyph, so it rotates
         rather than swapping — one element, two states, no reflow
         (Appendix O.11). */
      .pretui-lm-twisty {
        flex: 0 0 auto;
        width: 10px;
        height: 10px;
        border-inline-start: 4px solid currentColor;
        border-block-start: 4px solid transparent;
        border-block-end: 4px solid transparent;
        color: var(--muted-foreground);
        cursor: pointer;
        transition: transform var(--pretui-lm-transition, 140ms) ease;
      }
      .pretui-lm-twisty[data-open='true'] {
        transform: rotate(90deg);
      }
      .pretui-lm-twisty[data-leaf='true'] {
        border-inline-start-color: transparent;
        cursor: default;
      }

      .pretui-lm-glyph {
        flex: 0 0 auto;
        width: 13px;
        text-align: center;
        font-size: 10px;
        line-height: 1;
        color: var(--muted-foreground);
      }
      .pretui-lm-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--foreground);
      }
      .pretui-lm-badge {
        flex: 0 0 auto;
        font-size: var(--text-ui-xs, 10px);
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .pretui-lm-trailing {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      /* Hidden and locked read in greyscale: the name loses weight and the
         word beside it says which. Never the tint alone. */
      .pretui-lm-row[data-hidden='true'] .pretui-lm-text,
      .pretui-lm-row[data-hidden='true'] .pretui-lm-glyph {
        opacity: 0.5;
      }
      .pretui-lm-row[data-locked='true'] .pretui-lm-text {
        font-style: italic;
      }

      /* ── the eye ── a shape, drawn, so the state is legible without a
         colour and without an icon font. */
      .pretui-lm-eye {
        position: relative;
        display: block;
        width: 13px;
        height: 8px;
        border: 1.25px solid currentColor;
        border-radius: 100% / 62%;
      }
      .pretui-lm-eye::before {
        content: '';
        position: absolute;
        inset-block-start: 1px;
        inset-inline-start: 4px;
        width: 3.5px;
        height: 3.5px;
        border-radius: 50%;
        background: currentColor;
      }
      /* Pressed means "this layer is hidden", so the slash appears — the
         shape carries the state and aria-pressed carries it again. */
      .pretui-lm-toggle[aria-pressed='true'] .pretui-lm-eye::after {
        content: '';
        position: absolute;
        inset-block-start: 3px;
        inset-inline-start: -2px;
        width: 17px;
        height: 1.25px;
        background: currentColor;
        transform: rotate(-32deg);
      }
      /* An ancestor is doing the hiding: the button is drawn quietly and its
         accessible name names the group responsible, rather than reporting a
         flag that has no effect. */
      .pretui-lm-toggle[data-inherited='true'] {
        opacity: 0.45;
      }

      /* ── the padlock ── body plus shackle; unlocked tilts the shackle
         open rather than changing colour. */
      .pretui-lm-lock {
        position: relative;
        display: block;
        width: 9px;
        height: 7px;
        margin-block-start: 4px;
        border: 1.25px solid currentColor;
        border-radius: 1.5px;
      }
      .pretui-lm-lock::before {
        content: '';
        position: absolute;
        inset-block-start: -5px;
        inset-inline-start: 1px;
        width: 5px;
        height: 5px;
        border: 1.25px solid currentColor;
        border-block-end: 0;
        border-radius: 3px 3px 0 0;
        transform-origin: 100% 100%;
        transition: transform var(--pretui-lm-transition, 140ms) ease;
      }
      .pretui-lm-toggle[aria-pressed='false'] .pretui-lm-lock::before {
        transform: rotate(-28deg) translateY(-1px);
      }
      .pretui-lm-toggle[aria-pressed='true'] .pretui-lm-lock {
        background: color-mix(in oklch, currentColor 22%, transparent);
      }

      /* The flag controls are quiet at rest and full strength the moment the
         row is engaged — but they are never absent and never invisible. A
         focusable control at opacity 0 is worse than no control at all. */
      .pretui-lm-toggle {
        opacity: 0.55;
      }
      .pretui-lm-row:hover .pretui-lm-toggle,
      .pretui-lm-row:focus-within .pretui-lm-toggle,
      .pretui-lm-row[data-hidden='true'] .pretui-lm-toggle,
      .pretui-lm-row[data-locked='true'] .pretui-lm-toggle {
        opacity: 1;
      }

      .pretui-lm-hint {
        margin: 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      /* Text for assistive technology only. Not display:none — that removes
         it from the accessibility tree along with everything it would say. */
      .pretui-lm-live {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
      }

      @media (prefers-reduced-motion: reduce) {
        .pretui-lm-twisty,
        .pretui-lm-lock::before {
          transition: none;
        }
      }
      /* A 26px row is not a 44px touch target, so on a coarse pointer the
         controls grow into the row rather than the row growing into the
         page — and the hover-quietened toggles stop being quiet, because
         there is no hover to reveal them. */
      @media (any-pointer: coarse) {
        .pretui-lm {
          --pretui-lm-row-h: 36px;
        }
        .pretui-lm-handle {
          width: 28px;
        }
        .pretui-lm-toggle {
          opacity: 1;
        }
      }
    </style>
  </template>
}
