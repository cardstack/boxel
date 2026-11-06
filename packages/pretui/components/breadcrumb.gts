// Pretui — Breadcrumb: the trail of locations above the current page.
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

export interface CrumbSpec {
  label: string;
  href?: string;
}

export interface BreadcrumbSignature<T extends CrumbSpec = CrumbSpec> {
  Args: {
    items: T[];
    // Called when a linked crumb is clicked, with its item and the click. The
    // link follows its `href` unless the handler calls `preventDefault()`.
    onSelect?: (item: T, event: MouseEvent) => void;
  };
  Element: HTMLElement;
}

export class Breadcrumb<T extends CrumbSpec = CrumbSpec> extends Component<BreadcrumbSignature<T>> {
  isLast = (index: number) => index === this.args.items.length - 1;
  select = (item: T, event: MouseEvent) => this.args.onSelect?.(item, event);
  <template>
    <nav class='pretui-breadcrumb' aria-label='Breadcrumb' data-test-pretui-breadcrumb ...attributes>
      {{#each @items as |item index|}}
        {{#if index}}<span class='sep' aria-hidden='true' data-test-pretui-breadcrumb-sep>/</span>{{/if}}
        {{#if (this.isLast index)}}
          <b aria-current='page'>{{item.label}}</b>
        {{else if item.href}}
          <a href={{item.href}} {{on 'click' (fn this.select item)}}>{{item.label}}</a>
        {{else}}
          <span>{{item.label}}</span>
        {{/if}}
      {{/each}}
    </nav>
    <style scoped>
      @layer PretComponent {
        /* A trail longer than its container wraps onto more lines, and a
           label longer than a line breaks within itself. */
        .pretui-breadcrumb {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--boxel-sp-4xs) var(--boxel-sp-2xs);
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground);
          overflow-wrap: anywhere;
        }
        .pretui-breadcrumb b {
          color: var(--foreground);
          font-weight: 500;
        }
        .pretui-breadcrumb a {
          color: inherit;
          text-decoration: none;
        }
        .pretui-breadcrumb a:hover {
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .sep {
          color: var(--subtle-foreground);
        }
      }
    </style>
  </template>
}
