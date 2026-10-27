// Where one of the user's keys is used, as the key page's tile shows it: the
// services its approved requests go to, by registrable domain, and the
// workspaces it is shared into, counted, with a disclosure listing each by
// name and address as the share page shows a workspace. Both come with the key
// in the key listing (`usedWith`, `sharedInto`), so drawing them asks nothing
// more of the realm server. A domain is the realm server's; the page never
// derives one.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import Globe from '../../components/icons/globe.gts';
import LayoutGrid from '../../components/icons/layout-grid.gts';
import { eq } from '../../helpers/truth-helpers.ts';

import type { UserKey } from './context.ts';
import { addressOf } from './workspace-dropdown.gts';

interface Signature {
  Args: { key: UserKey };
}

const KeyUse: TemplateOnlyComponent<Signature> = <template>
  <div class='key-use'>
    <div class='use-row' data-test-key-used-with>
      <Globe class='use-icon' aria-hidden='true' />
      {{#if @key.usedWith.length}}
        <p class='use-text'>Used with
          {{#each @key.usedWith as |domain index|}}{{#if index}},
            {{/if}}<span
              class='domain'
              data-test-key-used-with-domain
            >{{domain}}</span>{{/each}}</p>
      {{else}}
        <p class='use-text none'>Not used with any service yet</p>
      {{/if}}
    </div>
    <div class='use-row' data-test-key-shared-into>
      <LayoutGrid class='use-icon' aria-hidden='true' />
      {{#if @key.sharedInto.length}}
        <details class='shared' data-test-key-shared-into-disclosure>
          <summary class='use-text' data-test-key-shared-into-summary>Shared
            into
            {{@key.sharedInto.length}}
            {{if
              (eq @key.sharedInto.length 1)
              'workspace'
              'workspaces'
            }}</summary>
          <ul class='workspaces' data-test-key-shared-into-list>
            {{#each @key.sharedInto as |workspace|}}
              <li data-test-key-shared-into-workspace={{workspace.url}}>
                <span class='workspace-name'>{{workspace.name}}</span>
                <span class='address'>{{addressOf workspace.url}}</span>
              </li>
            {{/each}}
          </ul>
        </details>
      {{else}}
        <p class='use-text none'>Not shared into any workspace</p>
      {{/if}}
    </div>
  </div>

  <style scoped>
    .key-use {
      display: grid;
      gap: var(--boxel-sp-4xs);
      padding-top: var(--boxel-sp-4xs);
      border-top: 1px solid var(--border);
    }
    .use-row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      column-gap: var(--boxel-sp-xs);
      align-items: start;
    }
    .use-icon {
      width: 0.875rem;
      height: 0.875rem;
      margin-top: 0.1875rem;
      color: var(--muted-foreground);
    }
    .use-text {
      margin: 0;
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      overflow-wrap: anywhere;
    }
    .none {
      color: var(--muted-foreground);
    }
    .domain {
      font-weight: 600;
    }
    .shared summary {
      width: fit-content;
      cursor: pointer;
      font-weight: 600;
    }
    .shared summary:focus-visible {
      outline: 2px solid var(--ring, var(--boxel-highlight));
      border-radius: var(--boxel-border-radius-xs, 2px);
    }
    .workspaces {
      list-style: none;
      margin: var(--boxel-sp-4xs) 0 0;
      padding: 0;
      display: grid;
      gap: var(--boxel-sp-4xs);
    }
    .workspace-name {
      display: block;
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    /* An address wraps rather than being cut short, since the part that
       tells two workspaces apart may be at its end. */
    .address {
      display: block;
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      color: var(--muted-foreground);
      overflow-wrap: anywhere;
    }
  </style>
</template>;

export default KeyUse;
