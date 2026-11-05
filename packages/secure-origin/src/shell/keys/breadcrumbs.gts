// The trail of key pages the window came through to this one (`trail.ts`),
// on the window's purple above the page: each page above this one is a link
// back to it as it was opened, and this page is last, unlinked. A page
// reached from none draws nothing.
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { goBackTo, trail, type Crumb } from './trail.ts';

export default class Breadcrumbs extends Component {
  <template>
    {{#if this.shown}}
      <nav class='breadcrumbs' aria-label='Breadcrumb' data-test-breadcrumbs>
        <ol>
          {{#each this.crumbs as |crumb index|}}
            <li>
              {{#if (this.isLast index)}}
                <span aria-current='page' data-test-breadcrumb-current>
                  {{crumb.label}}</span>
              {{else}}
                <a
                  href={{crumb.url}}
                  data-test-breadcrumb={{index}}
                  {{on 'click' (fn this.goBack crumb)}}
                >{{crumb.label}}</a>
                <span class='separator' aria-hidden='true'>›</span>
              {{/if}}
            </li>
          {{/each}}
        </ol>
      </nav>
    {{/if}}
    <style scoped>
      .breadcrumbs {
        padding: 0 var(--boxel-sp) var(--boxel-sp-xs);
        color: var(--boxel-light);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
      }
      ol {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-4xs) var(--boxel-sp-xs);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      li {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      a {
        color: var(--boxel-light);
        text-decoration: underline;
        text-underline-offset: 0.2em;
        border-radius: var(--boxel-border-radius-xs);
      }
      a:hover {
        text-decoration-thickness: 2px;
      }
      [aria-current='page'] {
        font-weight: 600;
      }
      .separator {
        opacity: 0.8;
      }
    </style>
  </template>

  private crumbs: Crumb[] = trail();

  private get shown() {
    return this.crumbs.length > 1;
  }

  private isLast = (index: number) => index === this.crumbs.length - 1;

  private goBack = (crumb: Crumb, event: Event) => {
    event.preventDefault();
    goBackTo(crumb, this.crumbs);
  };
}
