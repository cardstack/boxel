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
    // Called on a plain click of a linked crumb, with its item and the click.
    // The link follows its `href` unless the handler calls `preventDefault()`.
    // A modified or non-primary click is left to the browser.
    onSelect?: (item: T, event: MouseEvent) => void;
  };
  Element: HTMLElement;
}

export class Breadcrumb<T extends CrumbSpec = CrumbSpec> extends Component<BreadcrumbSignature<T>> {
  isLast = (index: number) => index === this.args.items.length - 1;
  select = (item: T, event: MouseEvent) => {
    // A Cmd/Ctrl-, Shift- or Alt-click opens the link in a new tab or window,
    // which is the browser's to do.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    this.args.onSelect?.(item, event);
  };
  <template>
    <nav class='pretui-breadcrumb' aria-label='Breadcrumb' data-test-pretui-breadcrumb ...attributes>
      <ol>
        {{#each @items as |item index|}}
          <li data-test-pretui-breadcrumb-item={{index}}>
            {{#if index}}<span class='sep' aria-hidden='true' data-test-pretui-breadcrumb-sep>/</span>{{/if}}
            {{#if (this.isLast index)}}
              <b aria-current='page' data-test-pretui-breadcrumb-label data-test-pretui-breadcrumb-current>{{item.label}}</b>
            {{else if item.href}}
              <a href={{item.href}} data-test-pretui-breadcrumb-label {{on 'click' (fn this.select item)}}>{{item.label}}</a>
            {{else}}
              <span data-test-pretui-breadcrumb-label>{{item.label}}</span>
            {{/if}}
          </li>
        {{/each}}
      </ol>
    </nav>
    <style scoped>
      @layer PretComponent {
        .pretui-breadcrumb {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground);
        }
        /* A trail longer than its container wraps onto more lines, each crumb
           keeping the separator before it, and a label longer than a line
           breaks within itself. `break-word` rather than `anywhere`, so the
           trail is never narrower than its longest word when its slot sizes
           to its content. */
        .pretui-breadcrumb ol {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--boxel-sp-4xs) var(--boxel-sp-2xs);
          margin: 0;
          padding: 0;
          list-style: none;
          overflow-wrap: break-word;
        }
        .pretui-breadcrumb li {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-2xs);
          min-width: 0;
        }
        /* A label may shrink below its content's width, so a long one can
           break within its line. */
        .pretui-breadcrumb li > :not(.sep) {
          min-width: 0;
        }
        .pretui-breadcrumb b {
          color: var(--foreground);
          font-weight: 500;
        }
        .pretui-breadcrumb a {
          color: inherit;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .pretui-breadcrumb a:hover {
          text-decoration-thickness: 2px;
        }
        .sep {
          color: var(--subtle-foreground);
        }
      }
    </style>
  </template>
}
