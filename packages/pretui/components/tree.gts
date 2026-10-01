// Pretui — Tree: the WAI-ARIA APG treeview, complete: roles, levels, roving tabindex, arrow keys and type-ahead.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { focusWhen, listen, rovingTabindex } from '../focus';
import { StatusChip } from './status-chip';
import { EmptyState } from './empty-state';
import { iconFor } from '../icon-registry';

// ── Tree ─────────────────────────────────────────────────────────────────
// The ARIA treeview pattern, complete.
//
// PRESENTATION NOTE (deliberate, not a shortcut): the tree renders FLAT —
// one <ul role='tree'> whose <li role='treeitem'> children each carry
// aria-level / aria-posinset / aria-setsize — rather than nesting a
// <ul role='group'> per branch. Both are conformant; the flat form is what
// production trees that must stay fast (VS Code's explorer, every virtualized
// tree) use, because DOM depth stays O(1) in the hierarchy depth, keyboard
// order is literally DOM order, and no self-recursive component is needed.
// aria-level carries the depth that the nesting would have carried.
//
// Dropped from the upstream surfaces on purpose: multi-select (aria-multi-
// selectable + Shift/Ctrl ranges — a second selection model the kit has no
// consumer for yet; say so rather than half-ship it, Law 7), drag-to-reorder
// (that is <Reorder>'s job), and inline rename (an editing surface, not a
// reading one). Multi-CHARACTER type-ahead is dropped for a hard reason: the
// buffer reset needs a timer and the realm forbids timers, so type-ahead here
// is single-character cycling — press 'd' repeatedly to walk every visible
// node starting with "d".

export interface TreeNode {
  /** stable id — the expansion and selection key */
  id: string;
  /** the node's text; override the rendering with the <:label> block */
  label: string;
  /** icon-registry name (see icon-registry.gts) rendered before the label */
  icon?: string;
  /** status value → StatusChip, hue derived from the value (Law 2) */
  badge?: string;
  /** quiet trailing text (counts, sizes, ids) */
  meta?: string;
  /** node cannot be selected; it still takes keyboard focus so the branch
   * below it stays reachable */
  disabled?: boolean;
  /** child nodes — presence is what makes a node a branch */
  children?: TreeNode[];
}

/** One VISIBLE row of the flattened tree: the node plus everything the ARIA
 * attributes and the keyboard need. Yielded to the <:label> block. */
export interface TreeRow {
  node: TreeNode;
  id: string;
  /** 1-based depth, straight into aria-level */
  level: number;
  /** 1-based position among its siblings */
  posinset: number;
  /** sibling count */
  setsize: number;
  parentId?: string;
  hasChildren: boolean;
  expanded: boolean;
  style: ReturnType<typeof htmlSafe>;
}

export interface TreeSignature {
  Args: {
    /** the hierarchy; each node may carry children recursively */
    nodes: TreeNode[];
    /** accessible name for the tree — required in spirit, defaulted so
     * nothing is required in practice (Law 7) */
    label?: string;
    /** controlled expanded ids; omit for uncontrolled */
    expanded?: string[];
    /** initial expanded ids when uncontrolled */
    defaultExpanded?: string[];
    /** fires with the full expanded-id list on every expand/collapse */
    onExpandedChange?: (ids: string[]) => void;
    /** controlled selected id; omit for uncontrolled */
    selected?: string | null;
    /** initial selected id when uncontrolled */
    defaultSelected?: string;
    /** fires with the node on Enter/Space/click */
    onSelect?: (node: TreeNode) => void;
    /** px of indent per level — also settable as --pretui-tree-indent */
    indent?: number;
    /** row height preset: 'compact' 22px, 'comfortable' 26px (default) */
    density?: 'compact' | 'comfortable';
    /** single-character type-ahead (default true) */
    typeahead?: boolean;
  };
  Blocks: {
    /** replaces the label text; receives the node and its row state */
    label?: [node: TreeNode, row: TreeRow];
    /** replaces the default EmptyState when @nodes is empty */
    empty?: [];
  };
  Element: HTMLDivElement;
}

export class Tree extends Component<TreeSignature> {
  @tracked private internalExpanded: string[] =
    this.args.defaultExpanded ?? [];
  @tracked private internalSelected: string | undefined =
    this.args.defaultSelected;
  @tracked private focusId: string | undefined = this.args.defaultSelected;
  // true only while the keyboard is driving — focusWhen never fires on a
  // pointer path or a plain re-render
  @tracked private navigating = false;

  get label(): string {
    return this.args.label ?? 'Tree';
  }
  get density(): 'compact' | 'comfortable' {
    return this.args.density ?? 'comfortable';
  }
  get hostStyle(): ReturnType<typeof htmlSafe> | undefined {
    let indent = this.args.indent;
    return indent === undefined
      ? undefined
      : htmlSafe(`--pretui-tree-indent: ${Math.max(0, indent)}px`);
  }
  private get expandedSet(): Set<string> {
    return new Set(this.args.expanded ?? this.internalExpanded);
  }
  get selectedId(): string | undefined {
    let controlled = this.args.selected;
    if (controlled !== undefined) {
      return controlled ?? undefined;
    }
    return this.internalSelected;
  }

  /** The visible rows, depth-first, in DOM order. */
  get rows(): TreeRow[] {
    let expanded = this.expandedSet;
    let out: TreeRow[] = [];
    let walk = (nodes: TreeNode[], level: number, parentId?: string) => {
      let setsize = nodes.length;
      for (let i = 0; i < setsize; i++) {
        let node = nodes[i];
        let hasChildren = !!node.children?.length;
        let isOpen = hasChildren && expanded.has(node.id);
        out.push({
          node,
          id: node.id,
          level,
          posinset: i + 1,
          setsize,
          parentId,
          hasChildren,
          expanded: isOpen,
          style: htmlSafe(`--_level: ${level}`),
        });
        if (isOpen) {
          walk(node.children as TreeNode[], level + 1, node.id);
        }
      }
    };
    walk(this.args.nodes ?? [], 1, undefined);
    return out;
  }
  get hasRows(): boolean {
    return this.rows.length > 0;
  }
  /** The single tab stop: the focused row, or the first row if the focused
   * one scrolled out of visibility (its branch was collapsed). */
  get rovingId(): string | undefined {
    let rows = this.rows;
    let current = this.focusId;
    if (current && rows.some((r) => r.id === current)) {
      return current;
    }
    return rows[0]?.id;
  }

  isSelected = (row: TreeRow): boolean => row.id === this.selectedId;
  isRoving = (row: TreeRow): boolean => row.id === this.rovingId;
  isFocusTarget = (row: TreeRow): boolean =>
    this.navigating && row.id === this.rovingId;
  /** 'true' | 'false' for branches, undefined (attribute removed) for leaves */
  expandedAttr = (row: TreeRow): string | undefined =>
    row.hasChildren ? (row.expanded ? 'true' : 'false') : undefined;
  // returns the boxel-ui icon component for the node's icon name (any-typed
  // by the registry)
  iconOf = (row: TreeRow) => iconFor(row.node.icon);

  private setExpanded(id: string, open: boolean) {
    let next = this.expandedSet;
    if (open) {
      next.add(id);
    } else {
      next.delete(id);
    }
    let ids = Array.from(next);
    if (this.args.expanded === undefined) {
      this.internalExpanded = ids;
    }
    this.args.onExpandedChange?.(ids);
  }
  private toggle(row: TreeRow) {
    if (!row.hasChildren) {
      return;
    }
    // collapsing can hide the focused descendant — park the tab stop on the
    // branch the reader just closed rather than snapping to the tree's top
    this.focusId = row.id;
    this.setExpanded(row.id, !row.expanded);
  }
  private select(row: TreeRow) {
    if (row.node.disabled) {
      return;
    }
    if (this.args.selected === undefined) {
      this.internalSelected = row.id;
    }
    this.args.onSelect?.(row.node);
  }
  private moveTo(row: TreeRow | undefined) {
    if (!row) {
      return;
    }
    this.navigating = true;
    this.focusId = row.id;
  }

  private rowFromEvent(event: Event): TreeRow | undefined {
    let target = event.target as HTMLElement | null;
    let el = target?.closest('[data-tree-id]') as HTMLElement | null;
    let id = el?.dataset.treeId;
    return id ? this.rows.find((r) => r.id === id) : undefined;
  }

  onClick = (event: Event) => {
    let row = this.rowFromEvent(event);
    if (!row) {
      return;
    }
    // the pointer already moved focus (tabindex=-1 elements are mouse
    // focusable) — do not let focusWhen fire a second time
    this.navigating = false;
    this.focusId = row.id;
    let target = event.target as HTMLElement | null;
    if (target?.closest('[data-tree-twisty]')) {
      this.toggle(row);
      return;
    }
    this.select(row);
  };

  // Keeps the tab stop wherever the reader last was, including after a Tab
  // into the tree from elsewhere on the page.
  //
  // The early return is load-bearing, not an optimisation: focusWhen's
  // el.focus() dispatches focusin SYNCHRONOUSLY from inside the modifier,
  // i.e. during the render transaction. Writing tracked state there is a
  // backtracking re-render. When the incoming target is already the roving
  // row, the focus was ours and there is nothing to record.
  onFocusIn = (event: Event) => {
    let row = this.rowFromEvent(event);
    if (!row || row.id === this.rovingId) {
      return;
    }
    this.navigating = false;
    this.focusId = row.id;
  };

  onKeydown = (event: Event) => {
    let ev = event as KeyboardEvent;
    if (ev.altKey || ev.metaKey || ev.ctrlKey) {
      return;
    }
    let rows = this.rows;
    let index = rows.findIndex((r) => r.id === this.rovingId);
    if (index < 0) {
      return;
    }
    let row = rows[index];
    let key = ev.key;
    if (key === 'ArrowDown') {
      ev.preventDefault();
      this.moveTo(rows[Math.min(rows.length - 1, index + 1)]);
    } else if (key === 'ArrowUp') {
      ev.preventDefault();
      this.moveTo(rows[Math.max(0, index - 1)]);
    } else if (key === 'ArrowRight') {
      ev.preventDefault();
      if (row.hasChildren && !row.expanded) {
        this.setExpanded(row.id, true);
      } else if (row.expanded) {
        // descend to the first child — it is the next visible row
        this.moveTo(rows[index + 1]);
      }
    } else if (key === 'ArrowLeft') {
      ev.preventDefault();
      if (row.expanded) {
        this.setExpanded(row.id, false);
      } else if (row.parentId) {
        this.moveTo(rows.find((r) => r.id === row.parentId));
      }
    } else if (key === 'Home') {
      ev.preventDefault();
      this.moveTo(rows[0]);
    } else if (key === 'End') {
      ev.preventDefault();
      this.moveTo(rows[rows.length - 1]);
    } else if (key === 'Enter' || key === ' ') {
      ev.preventDefault();
      if (row.hasChildren) {
        this.setExpanded(row.id, !row.expanded);
      }
      this.select(row);
    } else if (key === '*') {
      // APG: expand every sibling at the focused node's level
      ev.preventDefault();
      let next = this.expandedSet;
      for (let sibling of rows) {
        if (sibling.parentId === row.parentId && sibling.hasChildren) {
          next.add(sibling.id);
        }
      }
      let ids = Array.from(next);
      if (this.args.expanded === undefined) {
        this.internalExpanded = ids;
      }
      this.args.onExpandedChange?.(ids);
    } else if (
      (this.args.typeahead ?? true) &&
      key.length === 1 &&
      /\S/.test(key)
    ) {
      // single-character cycling type-ahead — a multi-character buffer would
      // need a debounce timer, and the realm forbids timers
      let ch = key.toLowerCase();
      for (let step = 1; step <= rows.length; step++) {
        let candidate = rows[(index + step) % rows.length];
        if (candidate.node.label.toLowerCase().startsWith(ch)) {
          ev.preventDefault();
          this.moveTo(candidate);
          break;
        }
      }
    }
  };

  <template>
    <div
      class='pretui-tree-host'
      data-density={{this.density}}
      style={{this.hostStyle}}
      data-test-pretui-tree
      ...attributes
    >
      {{#if this.hasRows}}
        <ul
          class='pretui-tree'
          role='tree'
          aria-label={{this.label}}
          {{listen 'click' this.onClick}}
          {{listen 'keydown' this.onKeydown}}
          {{listen 'focusin' this.onFocusIn}}
        >
          {{#each this.rows key='id' as |row|}}
            <li
              class='pretui-tree-item'
              role='treeitem'
              data-tree-id={{row.id}}
              data-selected={{if (this.isSelected row) 'true'}}
              data-branch={{if row.hasChildren 'true'}}
              aria-level={{row.level}}
              aria-posinset={{row.posinset}}
              aria-setsize={{row.setsize}}
              aria-expanded={{this.expandedAttr row}}
              aria-selected={{if (this.isSelected row) 'true' 'false'}}
              aria-disabled={{if row.node.disabled 'true'}}
              style={{row.style}}
              {{rovingTabindex (this.isRoving row)}}
              {{focusWhen (this.isFocusTarget row)}}
            >
              <span
                class='pretui-tree-twisty'
                data-tree-twisty
                data-open={{if row.expanded 'true'}}
                data-leaf={{unless row.hasChildren 'true'}}
                aria-hidden='true'
              ></span>
              {{#let (this.iconOf row) as |NodeIcon|}}
                {{#if NodeIcon}}
                  <NodeIcon class='pretui-tree-icon' role='presentation' />
                {{/if}}
              {{/let}}
              <span class='pretui-tree-label'>
                {{#if (has-block 'label')}}
                  {{yield row.node row to='label'}}
                {{else}}
                  {{row.node.label}}
                {{/if}}
              </span>
              {{#if row.node.badge}}
                <StatusChip @value={{row.node.badge}} />
              {{/if}}
              {{#if row.node.meta}}
                <span class='pretui-tree-meta'>{{row.node.meta}}</span>
              {{/if}}
            </li>
          {{/each}}
        </ul>
      {{else if (has-block 'empty')}}
        {{yield to='empty'}}
      {{else}}
        <EmptyState
          @title='Nothing to expand'
          @message='This hierarchy has no nodes yet.'
          @texture={{false}}
        />
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-tree-host {
          min-width: 0;
        }
        .pretui-tree {
          list-style: none;
          margin: 0;
          padding: var(--pretui-tree-pad, 4px);
          display: grid;
          gap: 1px;
          font-size: var(--text-ui-md, 12.5px);
          color: var(--foreground);
        }
        .pretui-tree-item {
          position: relative;
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          min-height: var(--pretui-tree-row-height, 26px);
          padding-block: 0;
          padding-inline: calc(
              8px + var(--pretui-tree-indent, 14px) * (var(--_level, 1) - 1)
            )
            8px;
          border-radius: var(--radius-chip, 6px);
          cursor: default;
          user-select: none;
        }
        .pretui-tree-host[data-density='compact'] .pretui-tree-item {
          min-height: var(--pretui-tree-row-height, 22px);
          font-size: var(--text-ui, 12px);
        }
        .pretui-tree-item:hover {
          background: var(--hover, var(--boxel-100));
        }
        .pretui-tree-item[data-selected='true'] {
          background: var(--pretui-selected, var(--boxel-100));
          color: var(--pretui-primary-ink, var(--primary));
          font-weight: 500;
        }
        /* Law 8 — the selection is legible in a still frame: tint plus a rail */
        .pretui-tree-item[data-selected='true']::before {
          content: '';
          position: absolute;
          left: 2px;
          top: 3px;
          bottom: 3px;
          width: 2px;
          border-radius: 1px;
          background: var(--pretui-primary-ink, var(--primary));
        }
        .pretui-tree-item[aria-disabled='true'] {
          opacity: 0.45;
        }
        .pretui-tree-item:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -1px;
        }
        .pretui-tree-twisty {
          width: 14px;
          height: 14px;
          flex: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: var(--ink-3, var(--boxel-400));
          transition: transform 140ms var(--pretui-ease-snap, ease);
        }
        /* the twisty is drawn, not typed — no glyph, no font dependency, and
           it scales with the row */
        .pretui-tree-twisty::before {
          content: '';
          width: 0;
          height: 0;
          border-left: 4px solid currentColor;
          border-top: 3.5px solid transparent;
          border-bottom: 3.5px solid transparent;
        }
        .pretui-tree-twisty[data-open='true'] {
          transform: rotate(90deg);
        }
        .pretui-tree-twisty[data-leaf='true']::before {
          border-left-color: transparent;
        }
        .pretui-tree-icon {
          width: 14px;
          height: 14px;
          flex: none;
          color: var(--muted-foreground);
        }
        .pretui-tree-label {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .pretui-tree-meta {
          margin-left: auto;
          padding-left: 8px;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-tree-twisty {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
