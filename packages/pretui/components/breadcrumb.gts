// Pretui — Breadcrumb: the trail of locations above the current page.
import Component from '@glimmer/component';

export interface CrumbSpec {
  label: string;
  href?: string;
}

export interface BreadcrumbSignature {
  Args: { items: CrumbSpec[] };
  Element: HTMLElement;
}

export class Breadcrumb extends Component<BreadcrumbSignature> {
  isLast = (index: number) => index === this.args.items.length - 1;
  <template>
    <nav class='pretui-breadcrumb' aria-label='Breadcrumb' data-test-pretui-breadcrumb ...attributes>
      {{#each @items as |item index|}}
        {{#if index}}<span class='sep'>/</span>{{/if}}
        {{#if (this.isLast index)}}
          <b>{{item.label}}</b>
        {{else if item.href}}
          <a href={{item.href}}>{{item.label}}</a>
        {{else}}
          <span>{{item.label}}</span>
        {{/if}}
      {{/each}}
    </nav>
    <style scoped>
      .pretui-breadcrumb {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: var(--text-ui, 12px);
        color: var(--muted-foreground);
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
        color: var(--ink-3, var(--boxel-400));
      }
    </style>
  </template>
}
