// Pretui — TreeSelect: a select whose popup is a tree — the value is the set of checked nodes.
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { focusWhen, listenDocument } from '../focus';
import type { TreeNode } from './tree';

export interface TreeSelectSignature {
  Args: {
    /** The same node shape as Tree. */
    nodes: TreeNode[];
    /** Controlled checked ids, in tree order. Omit for uncontrolled. */
    value?: string[];
    defaultValue?: string[];
    onChange?: (ids: string[]) => void;
    /** Check any number of nodes (default true). False picks one node and closes. */
    multiple?: boolean;
    /** Checking a branch checks its descendants, and a branch is checked when all of them are (default true). */
    cascade?: boolean;
    /** Branches open when the popup opens. */
    defaultExpanded?: string[];
    /** The trigger's accessible name prefix and the tree's label. */
    label?: string;
    placeholder?: string;
    /** Chips shown in the trigger before '+N' (default 3). */
    maxChips?: number;
    disabled?: boolean;
  };
  Element: HTMLDivElement;
}

interface Row {
  node: TreeNode;
  depth: number;
  posinset: number;
  setsize: number;
  branch: boolean;
  expanded: boolean;
  checked: 'true' | 'false' | 'mixed';
  selected: boolean;
  focused: boolean;
  id: string;
}

function descendants(node: TreeNode): TreeNode[] {
  return (node.children ?? []).flatMap((child) => [child, ...descendants(child)]);
}

function flatten(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => [node, ...descendants(node)]);
}

/**
 * Ant's and Mantine's TreeSelect: pills of the checked nodes in the closed
 * state, a checkable tree in the popup. Cascader picks one path; Tree browses
 * without a value.
 *
 * The cascade policy is stated, not implied: with `@cascade` (the default)
 * checking a branch checks everything under it, a branch reads as checked
 * when all of its enabled descendants are and as mixed when some are, and
 * the trigger summarises a fully checked branch as one chip. The value is
 * every checked id in tree order, branches included.
 *
 * The popup follows the APG tree pattern: ArrowUp / ArrowDown through the
 * visible rows, ArrowRight to expand or step into a branch, ArrowLeft to
 * collapse or step out, Space to check, Home / End, Escape to close. Each
 * row is a treeitem with `aria-checked` (multiple) or `aria-selected`
 * (single) and, for a branch, `aria-expanded`.
 */
export class TreeSelect extends Component<TreeSelectSignature> {
  private guid = guidFor(this);
  @tracked private internal: string[] = [...(this.args.defaultValue ?? [])];
  @tracked open = false;
  @tracked expanded: string[] = [...(this.args.defaultExpanded ?? [])];
  @tracked focusId: string | undefined;

  get multiple(): boolean {
    return this.args.multiple ?? true;
  }
  get cascade(): boolean {
    return this.multiple && (this.args.cascade ?? true);
  }
  get value(): string[] {
    return this.args.value ?? this.internal;
  }
  /**
   * The value, normalised once: with the cascade, a listed branch stands for
   * its enabled descendants, and a branch is checked exactly when every
   * enabled leaf under it is. So `['dhp']` checks Oolong, and `['green']`
   * checks Sencha and Gyokuro, whichever ids the caller happened to list.
   */
  @cached
  get checkedSet(): Set<string> {
    let set = new Set(this.value);
    if (!this.cascade) {
      return set;
    }
    for (let node of flatten(this.args.nodes ?? [])) {
      if (set.has(node.id) && node.children?.length) {
        for (let d of descendants(node)) {
          if (!d.disabled) {
            set.add(d.id);
          }
        }
      }
    }
    let visit = (node: TreeNode): boolean => {
      if (!node.children?.length) {
        return set.has(node.id) && !node.disabled;
      }
      node.children.forEach(visit);
      let enabled = descendants(node).filter((d) => !d.disabled && !d.children?.length);
      let all = enabled.length > 0 && enabled.every((d) => set.has(d.id));
      if (all) {
        set.add(node.id);
      } else {
        set.delete(node.id);
      }
      return all;
    };
    for (let root of this.args.nodes ?? []) {
      visit(root);
    }
    return set;
  }
  get treeId(): string {
    return this.guid + '-tree';
  }

  private state(node: TreeNode): 'true' | 'false' | 'mixed' {
    let checked = this.checkedSet;
    if (!this.cascade || !node.children?.length) {
      return checked.has(node.id) ? 'true' : 'false';
    }
    if (checked.has(node.id)) {
      return 'true';
    }
    let leaves = descendants(node).filter((n) => !n.disabled && !n.children?.length);
    return leaves.some((n) => checked.has(n.id)) ? 'mixed' : 'false';
  }

  @cached
  get rows(): Row[] {
    let rows: Row[] = [];
    let expanded = new Set(this.expanded);
    let visit = (nodes: TreeNode[], depth: number) => {
      for (let [position, node] of nodes.entries()) {
        let branch = (node.children?.length ?? 0) > 0;
        let isOpen = branch && expanded.has(node.id);
        rows.push({
          node,
          depth,
          posinset: position + 1,
          setsize: nodes.length,
          branch,
          expanded: isOpen,
          checked: this.state(node),
          selected: this.checkedSet.has(node.id),
          focused: this.open && node.id === this.focusId,
          id: `${this.guid}-n-${node.id}`,
        });
        if (isOpen) {
          visit(node.children ?? [], depth + 1);
        }
      }
    };
    visit(this.args.nodes ?? [], 1);
    return rows;
  }

  /** The chips: a fully checked branch stands for everything under it. */
  @cached
  get chips(): TreeNode[] {
    let checked = this.checkedSet;
    let out: TreeNode[] = [];
    let visit = (nodes: TreeNode[]) => {
      for (let node of nodes) {
        if (checked.has(node.id)) {
          out.push(node);
          if (this.cascade) {
            continue;
          }
        }
        visit(node.children ?? []);
      }
    };
    visit(this.args.nodes ?? []);
    return out;
  }
  get shownChips(): TreeNode[] {
    return this.chips.slice(0, this.args.maxChips ?? 3);
  }
  get moreCount(): number {
    return Math.max(0, this.chips.length - this.shownChips.length);
  }
  get triggerName(): string {
    let label = this.args.label ?? 'Choose';
    let names = this.chips.map((n) => n.label);
    return names.length ? `${label}: ${names.join(', ')}` : label;
  }

  private commit(ids: Set<string>) {
    let ordered = flatten(this.args.nodes ?? []).map((n) => n.id).filter((id) => ids.has(id));
    if (this.args.value === undefined) {
      this.internal = ordered;
    }
    this.args.onChange?.(ordered);
  }

  toggleNode = (node: TreeNode) => {
    if (node.disabled) {
      return;
    }
    this.focusId = node.id;
    if (!this.multiple) {
      this.commit(new Set([node.id]));
      this.close(true);
      return;
    }
    let next = new Set(this.checkedSet);
    let on = this.state(node) !== 'true';
    let affected = this.cascade ? [node, ...descendants(node).filter((n) => !n.disabled)] : [node];
    for (let n of affected) {
      if (on) {
        next.add(n.id);
      } else {
        next.delete(n.id);
      }
    }
    if (this.cascade) {
      // A branch is checked exactly when all its enabled descendants are.
      for (let branch of flatten(this.args.nodes ?? []).filter((n) => n.children?.length).reverse()) {
        let leaves = descendants(branch).filter((n) => !n.disabled);
        if (leaves.length && leaves.every((n) => next.has(n.id))) {
          next.add(branch.id);
        } else if (leaves.length) {
          next.delete(branch.id);
        }
      }
    }
    this.commit(next);
  };

  toggleExpand = (node: TreeNode, event?: Event) => {
    event?.stopPropagation();
    this.focusId = node.id;
    this.expanded = this.expanded.includes(node.id)
      ? this.expanded.filter((id) => id !== node.id)
      : [...this.expanded, node.id];
  };

  toggle = () => {
    if (this.open) {
      this.close(false);
      return;
    }
    // focus the first listed value that still exists; a stale id has no row
    let ids = new Set(flatten(this.args.nodes ?? []).map((n) => n.id));
    let first = this.value.find((id) => ids.has(id)) ?? this.args.nodes?.[0]?.id;
    // open the branches that lead to what is checked, so it is visible
    let parents = new Set(this.expanded);
    for (let node of flatten(this.args.nodes ?? [])) {
      if (descendants(node).some((d) => this.checkedSet.has(d.id))) {
        parents.add(node.id);
      }
    }
    this.expanded = [...parents];
    this.focusId = first;
    this.open = true;
  };

  close(returnFocus: boolean) {
    this.open = false;
    if (returnFocus) {
      document.getElementById(this.guid + '-trigger')?.focus();
    }
  }

  private parentOf(id: string): TreeNode | undefined {
    return flatten(this.args.nodes ?? []).find((n) => n.children?.some((c) => c.id === id));
  }

  onKeydown = (rawEvent: Event) => {
    let event = rawEvent as KeyboardEvent;
    let rows = this.rows;
    let at = rows.findIndex((r) => r.node.id === this.focusId);
    let row = rows[at];
    let handled = true;
    if (event.key === 'ArrowDown') {
      this.focusId = rows[Math.min(rows.length - 1, at + 1)]?.node.id;
    } else if (event.key === 'ArrowUp') {
      this.focusId = rows[Math.max(0, at - 1)]?.node.id;
    } else if (event.key === 'Home') {
      this.focusId = rows[0]?.node.id;
    } else if (event.key === 'End') {
      this.focusId = rows[rows.length - 1]?.node.id;
    } else if (event.key === 'ArrowRight') {
      if (row?.branch && !row.expanded) {
        this.toggleExpand(row.node);
      } else if (row?.branch) {
        this.focusId = rows[at + 1]?.node.id;
      }
    } else if (event.key === 'ArrowLeft') {
      if (row?.branch && row.expanded) {
        this.toggleExpand(row.node);
      } else if (row) {
        let parent = this.parentOf(row.node.id);
        if (parent) {
          this.focusId = parent.id;
        }
      }
    } else if (event.key === ' ' || event.key === 'Enter') {
      if (row) {
        this.toggleNode(row.node);
      }
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      this.close(true);
    } else if (event.key === 'Tab') {
      this.close(false);
      handled = false;
    } else {
      handled = false;
    }
    if (handled) {
      event.preventDefault();
    }
  };

  onOutside = (event: Event) => {
    if (!this.open) {
      return;
    }
    let target = event.target as Node | null;
    let root = target?.ownerDocument?.getElementById(this.guid);
    if (root && target && root.contains(target)) {
      return;
    }
    this.close(false);
  };

  <template>
    <div id={{this.guid}} class='pretui-treeselect' data-open={{if this.open 'true' 'false'}} data-test-pretui-tree-select ...attributes>
      <button
        id='{{this.guid}}-trigger'
        type='button'
        class='pretui-treeselect-trigger'
        aria-haspopup='tree'
        aria-expanded={{if this.open 'true' 'false'}}
        aria-controls={{if this.open this.treeId}}
        aria-label={{this.triggerName}}
        disabled={{@disabled}}
        data-test-pretui-tree-select-trigger
        {{on 'click' this.toggle}}
      >
        {{#if this.chips.length}}
          <span class='pretui-treeselect-chips' aria-hidden='true'>
            {{#each this.shownChips as |node|}}
              <span class='pretui-treeselect-chip' data-test-pretui-tree-select-chip={{node.id}}>{{node.label}}</span>
            {{/each}}
            {{#if this.moreCount}}<span class='pretui-treeselect-more' data-test-pretui-tree-select-more>+{{this.moreCount}}</span>{{/if}}
          </span>
        {{else}}
          <span class='pretui-treeselect-placeholder'>{{if @placeholder @placeholder 'Select'}}</span>
        {{/if}}
        <span class='pretui-treeselect-caret' aria-hidden='true'></span>
      </button>
      {{#if this.open}}
        {{! template-lint-disable no-invalid-interactive }}
        <ul
          id={{this.treeId}}
          class='pretui-treeselect-tree'
          role='tree'
          aria-label={{if @label @label 'Options'}}
          aria-multiselectable={{if this.multiple 'true'}}
          data-test-pretui-tree-select-tree
          {{on 'keydown' this.onKeydown}}
          {{listenDocument 'pointerdown' this.onOutside true}}
        >
          {{#each this.rows key='id' as |row|}}
            <li
              id={{row.id}}
              class='pretui-treeselect-row'
              role='treeitem'
              aria-level={{row.depth}}
              aria-posinset={{row.posinset}}
              aria-setsize={{row.setsize}}
              aria-expanded={{if row.branch (if row.expanded 'true' 'false')}}
              aria-checked={{if this.multiple row.checked}}
              aria-selected={{unless this.multiple (if row.selected 'true' 'false')}}
              aria-disabled={{if row.node.disabled 'true'}}
              tabindex={{if row.focused '0' '-1'}}
              data-depth={{row.depth}}
              data-test-pretui-tree-select-node={{row.node.id}}
              {{focusWhen row.focused}}
              {{on 'click' (fn this.toggleNode row.node)}}
            >
              {{#if row.branch}}
                <span
                  class='pretui-treeselect-twisty'
                  data-open={{if row.expanded 'true' 'false'}}
                  aria-hidden='true'
                  data-test-pretui-tree-select-twisty={{row.node.id}}
                  {{on 'click' (fn this.toggleExpand row.node)}}
                ></span>
              {{else}}
                <span class='pretui-treeselect-twisty-space' aria-hidden='true'></span>
              {{/if}}
              {{#if this.multiple}}
                <span class='pretui-treeselect-box' data-state={{row.checked}} aria-hidden='true'></span>
              {{/if}}
              <span class='pretui-treeselect-label'>{{row.node.label}}</span>
            </li>
          {{/each}}
        </ul>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-treeselect {
          position: relative;
          display: inline-block;
          min-inline-size: 14rem;
          font-family: var(--font-sans);
          font-size: var(--text-ui-md, 0.78rem);
        }
        .pretui-treeselect-trigger {
          display: flex;
          align-items: center;
          gap: var(--space-2, 0.375rem);
          inline-size: 100%;
          min-block-size: var(--pretui-control-h, 2.25rem);
          padding: 0.25rem var(--space-3, 0.5rem);
          border: 0;
          border-radius: var(--radius-control, 6px);
          background: var(--input-background, var(--card));
          box-shadow: 0 0 0 1px var(--input, var(--border));
          color: var(--foreground);
          font: inherit;
          text-align: start;
          cursor: pointer;
        }
        .pretui-treeselect-trigger:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-treeselect-trigger:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .pretui-treeselect-chips {
          display: flex;
          flex: 1;
          flex-wrap: wrap;
          gap: 0.25rem;
          min-inline-size: 0;
        }
        .pretui-treeselect-chip,
        .pretui-treeselect-more {
          display: inline-flex;
          align-items: center;
          block-size: 1.375rem;
          padding-inline: 0.5rem;
          border-radius: var(--radius-chip, 6px);
          background: color-mix(in oklch, var(--muted-foreground) var(--pretui-chip-mix, 20%), var(--card));
          white-space: nowrap;
        }
        .pretui-treeselect-more {
          color: var(--muted-foreground);
          font-variant-numeric: tabular-nums;
        }
        .pretui-treeselect-placeholder {
          flex: 1;
          color: var(--muted-foreground);
        }
        .pretui-treeselect-caret {
          flex: none;
          inline-size: 0.4rem;
          block-size: 0.4rem;
          border-inline-end: 1.5px solid var(--muted-foreground);
          border-block-end: 1.5px solid var(--muted-foreground);
          rotate: 45deg;
          translate: 0 -0.1rem;
        }
        .pretui-treeselect-tree {
          position: absolute;
          inset-block-start: calc(100% + 0.25rem);
          inset-inline: 0;
          z-index: var(--pretui-z-dropdown, 60);
          max-block-size: 18rem;
          overflow-y: auto;
          margin: 0;
          padding: 0.25rem;
          list-style: none;
          border-radius: var(--radius-surface, 10px);
          background: var(--popover);
          color: var(--popover-foreground);
          box-shadow: var(--pretui-shadow-raised, 0 0 0 1px var(--border), 0 6px 20px rgb(16 24 40 / 0.12));
        }
        .pretui-treeselect-row {
          display: flex;
          align-items: center;
          gap: var(--space-2, 0.375rem);
          padding-block: 0.3rem;
          padding-inline: calc((var(--pretui-row-depth, 1) - 1) * 1rem + 0.25rem) var(--space-3, 0.5rem);
          border-radius: var(--radius-control, 6px);
          cursor: pointer;
        }
        .pretui-treeselect-row[data-depth='2'] {
          --pretui-row-depth: 2;
        }
        .pretui-treeselect-row[data-depth='3'] {
          --pretui-row-depth: 3;
        }
        .pretui-treeselect-row[data-depth='4'] {
          --pretui-row-depth: 4;
        }
        .pretui-treeselect-row[data-depth='5'] {
          --pretui-row-depth: 5;
        }
        .pretui-treeselect-row:hover,
        .pretui-treeselect-row:focus-visible {
          background: var(--hover, color-mix(in oklch, var(--foreground) 8%, transparent));
          outline: 0;
        }
        .pretui-treeselect-row:focus-visible {
          box-shadow: inset 0 0 0 2px var(--ring);
        }
        .pretui-treeselect-row[aria-selected='true'] {
          color: var(--primary);
          font-weight: 600;
        }
        .pretui-treeselect-row[aria-disabled='true'] {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .pretui-treeselect-twisty,
        .pretui-treeselect-twisty-space {
          flex: none;
          display: grid;
          place-items: center;
          inline-size: 1rem;
          block-size: 1rem;
        }
        .pretui-treeselect-twisty::before {
          content: '';
          inline-size: 0.35rem;
          block-size: 0.35rem;
          border-inline-end: 1.5px solid var(--muted-foreground);
          border-block-end: 1.5px solid var(--muted-foreground);
          rotate: -45deg;
          transition: rotate var(--pretui-dur-snap, 160ms) var(--pretui-ease-snap, ease-out);
        }
        .pretui-treeselect-twisty[data-open='true']::before {
          rotate: 45deg;
        }
        .pretui-treeselect-box {
          flex: none;
          display: grid;
          place-items: center;
          inline-size: 0.9rem;
          block-size: 0.9rem;
          border-radius: 3px;
          box-shadow: inset 0 0 0 1.5px var(--muted-foreground);
        }
        .pretui-treeselect-box[data-state='true'],
        .pretui-treeselect-box[data-state='mixed'] {
          background: var(--primary);
          box-shadow: none;
        }
        .pretui-treeselect-box[data-state='true']::after {
          content: '';
          inline-size: 0.25rem;
          block-size: 0.45rem;
          border-inline-end: 1.5px solid var(--primary-foreground);
          border-block-end: 1.5px solid var(--primary-foreground);
          rotate: 45deg;
          translate: 0 -0.05rem;
        }
        .pretui-treeselect-box[data-state='mixed']::after {
          content: '';
          inline-size: 0.45rem;
          block-size: 1.5px;
          background: var(--primary-foreground);
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-treeselect-twisty::before {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
