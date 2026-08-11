import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';

import { type OrgNode, stateColorOf } from '../utils/index';
import { EMPLOYEE_STATUS_COLORS } from '../employee';

export interface OrgTreeItem {
  id?: string;
  name?: string;
  role?: string;
  initials?: string;
  photoUrl?: string;
  status?: string;
  openReqs?: number;
}

interface OrgTreeNodeSignature {
  Args: {
    node: OrgNode<OrgTreeItem>;
    onSelect?: (item: OrgTreeItem) => void;
  };
}

class OrgTreeNode extends GlimmerComponent<OrgTreeNodeSignature> {
  @tracked expanded = true;

  get hasChildren() {
    return this.args.node.children.length > 0;
  }

  get reportCount() {
    return this.args.node.children.length;
  }

  // Recursive rollups — what makes this a hiring tool instead of a org
  // chart poster. "团队 2 · 在招 2" on a manager means their headcount is
  // about to double, which is the actual reason their interview load is
  // maxed out.
  get teamSize(): number {
    let count = (node: OrgNode<OrgTreeItem>): number =>
      node.children.reduce((sum, child) => sum + 1 + count(child), 0);
    return count(this.args.node);
  }

  get openReqsTotal(): number {
    let sum = (node: OrgNode<OrgTreeItem>): number =>
      (node.item.openReqs ?? 0) +
      node.children.reduce((total, child) => total + sum(child), 0);
    return sum(this.args.node);
  }

  get avatarRingStyle() {
    let color = stateColorOf(
      EMPLOYEE_STATUS_COLORS,
      this.args.node.item.status,
    );
    return htmlSafe(
      `box-shadow: 0 0 0 0.09375rem var(--background, var(--boxel-light)), 0 0 0 0.15625rem ${color.ring};`,
    );
  }

  toggle = () => {
    this.expanded = !this.expanded;
  };

  select = () => {
    this.args.onSelect?.(this.args.node.item);
  };

  <template>
    <li class='org-node'>
      <div class='org-row'>
        {{#if this.hasChildren}}
          <button
            type='button'
            class='caret {{if this.expanded "open"}}'
            aria-expanded='{{if this.expanded "true" "false"}}'
            aria-label='{{if this.expanded "Collapse" "Expand"}} reports'
            {{on 'click' this.toggle}}
          >▸</button>
        {{else}}
          <span class='caret-spacer'></span>
        {{/if}}
        {{#if @node.item.photoUrl}}
          <img
            class='avatar'
            src={{@node.item.photoUrl}}
            alt=''
            style={{this.avatarRingStyle}}
          />
        {{else}}
          <span
            class='avatar initials'
            style={{this.avatarRingStyle}}
          >{{@node.item.initials}}</span>
        {{/if}}
        <button type='button' class='org-label' {{on 'click' this.select}}>
          <span class='org-name'>{{@node.item.name}}</span>
          <span class='org-role'>{{@node.item.role}}</span>
        </button>
        {{#if this.hasChildren}}
          <span class='rollup'>
            <span class='rollup-chip'>Team {{this.teamSize}}</span>
            {{#if this.openReqsTotal}}
              <span class='rollup-chip rollup-hiring'>Hiring
                {{this.openReqsTotal}}</span>
            {{/if}}
          </span>
        {{else if @node.item.openReqs}}
          <span class='rollup-chip rollup-hiring'>Hiring
            {{@node.item.openReqs}}</span>
        {{/if}}
      </div>
      {{#if this.hasChildren}}
        <div class='org-children-wrap {{if this.expanded "expanded"}}'>
          <ul class='org-children'>
            {{#each @node.children as |child|}}
              <OrgTreeNode @node={{child}} @onSelect={{@onSelect}} />
            {{/each}}
          </ul>
        </div>
      {{/if}}
    </li>
    <style scoped>
      .org-node {
        list-style: none;
      }
      .org-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-4xs) var(--boxel-sp-4xs);
        border-radius: var(--boxel-border-radius-sm);
        transition: background-color 0.15s ease-out;
      }
      .org-row:hover {
        background: var(--muted, var(--boxel-100));
      }
      .caret {
        border: none;
        background: none;
        cursor: pointer;
        color: var(--muted-foreground, var(--boxel-450));
        width: 1rem;
        padding: 0;
        transition: transform 0.15s ease-out;
      }
      .caret.open {
        transform: rotate(90deg);
      }
      .caret-spacer {
        width: 1rem;
        flex: none;
      }
      .avatar {
        width: 1.75rem;
        height: 1.75rem;
        border-radius: 50%;
        flex: none;
        object-fit: cover;
        transition: box-shadow 0.15s ease-out;
      }
      .initials {
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        font-size: var(--boxel-font-size-xs);
        line-height: 1;
        color: var(--primary-foreground, var(--boxel-light));
        background: var(--primary, var(--boxel-highlight));
      }
      .org-label {
        border: none;
        background: none;
        cursor: pointer;
        text-align: left;
        display: flex;
        flex-direction: column;
        gap: 1px;
        padding: 0;
        min-width: 0;
        color: inherit;
        font-family: inherit;
      }
      .org-label:hover .org-name {
        text-decoration: underline;
      }
      .org-name {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
      }
      .org-role {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
      }
      .rollup {
        display: flex;
        gap: var(--boxel-sp-4xs);
      }
      .rollup-chip {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
        background: var(--muted, var(--boxel-100));
        border-radius: 999px;
        padding: 1px var(--boxel-sp-xs);
        white-space: nowrap;
      }
      .rollup-hiring {
        color: var(--primary-foreground, var(--boxel-light));
        background: var(--primary, var(--boxel-highlight));
      }
      .org-children-wrap {
        display: grid;
        grid-template-rows: 0fr;
        transition: grid-template-rows 0.2s ease-in-out;
      }
      .org-children-wrap.expanded {
        grid-template-rows: 1fr;
      }
      .org-children {
        margin: 0 0 0 calc(var(--boxel-sp) + 0.125rem);
        padding: 0 0 0 var(--boxel-sp-xs);
        border-left: 1px solid var(--border, var(--boxel-200));
        overflow: hidden;
        min-height: 0;
      }
      @media (prefers-reduced-motion: reduce) {
        .org-children-wrap {
          transition: none;
        }
      }
    </style>
  </template>
}

interface OrgTreeSignature {
  Args: {
    roots: OrgNode<OrgTreeItem>[];
    onSelect?: (item: OrgTreeItem) => void;
  };
  Element: HTMLElement;
}

// Recursive org-chart tree over a manager hierarchy.
export class OrgTree extends GlimmerComponent<OrgTreeSignature> {
  <template>
    <ul class='org-tree' ...attributes>
      {{#each @roots as |root|}}
        <OrgTreeNode @node={{root}} @onSelect={{@onSelect}} />
      {{else}}
        <li class='org-empty'>No employees yet.</li>
      {{/each}}
    </ul>
    <style scoped>
      .org-tree {
        margin: 0;
        padding: 0;
        font-family: var(--font-sans, var(--boxel-font-family));
        color: var(--foreground, var(--boxel-dark));
      }
      .org-empty {
        list-style: none;
        color: var(--muted-foreground, var(--boxel-450));
        font-size: var(--boxel-font-size-sm);
      }
    </style>
  </template>
}
