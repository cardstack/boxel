// One of the user's keys, drawn as a linked card is in a linksToMany field: a
// bordered tile with the key's icon, its name and when it was added. What the
// tile is given to hold (a key page's actions) goes on a line of its own under
// the name, so neither crowds the other however long the name. Nothing about
// its value is shown. A secret pasted in is what a key is unless the tile
// says otherwise: a Google service account, an OAuth app, or an account
// connected through one. `@framed={{false}}` leaves its border and
// background off, for a tile drawn inside a frame of its own, as a radio tile
// is, whose chosen fill then shows through.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import KeyRound from '../../components/icons/key-round.gts';
import cn from '../../helpers/cn.ts';
import { eq } from '../../helpers/truth-helpers.ts';

import type { UserKey } from './context.ts';

export function addedOn(iso: string): string {
  let date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
}

// What a key is, when it isn't a secret pasted in.
export function kindLabel(kind: string): string | undefined {
  switch (kind) {
    case 'google-service-account':
      return 'Google service account';
    case 'oauth-client':
      return 'Sign-in app';
    case 'oauth-connection':
      return 'Connected account';
    default:
      return undefined;
  }
}

interface Signature {
  Args: { key: UserKey; framed?: boolean };
  Blocks: { default: [] };
  Element: HTMLElement;
}

const KeyTile: TemplateOnlyComponent<Signature> = <template>
  <div class={{cn 'key-tile' unframed=(eq @framed false)}} ...attributes>
    <span class='key-icon' aria-hidden='true'><KeyRound /></span>
    <div class='key-text'>
      <div
        id='key-name-{{@key.id}}'
        class='key-name'
        data-test-key-row-name
      >{{@key.name}}</div>
      <div class='key-meta'>
        {{#if (kindLabel @key.kind)}}
          <span data-test-key-kind>{{kindLabel @key.kind}}</span>
          ·
        {{/if}}
        Added
        {{addedOn @key.createdAt}}
      </div>
    </div>
    {{#if (has-block)}}
      <div class='key-extra'>{{yield}}</div>
    {{/if}}
  </div>

  <style scoped>
    .key-tile {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      column-gap: var(--boxel-sp-sm);
      row-gap: var(--boxel-sp-xs);
      min-height: 4rem;
      padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      background-color: var(--card, var(--background));
      color: var(--card-foreground, var(--foreground));
      border-radius: var(--boxel-border-radius);
      box-shadow: 0 0 0 1px var(--border);
    }
    .unframed {
      background-color: transparent;
      box-shadow: none;
    }
    .key-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 2.5rem;
      height: 2.5rem;
      border-radius: var(--boxel-border-radius-sm);
      background-color: var(--muted);
      color: var(--muted-foreground);
    }
    .key-icon :deep(svg) {
      width: 1.25rem;
      height: 1.25rem;
    }
    .key-text {
      min-width: 0;
    }
    .key-extra {
      grid-column: 1 / -1;
    }
    .key-name {
      font-size: var(--boxel-font-size-sm);
      line-height: var(--boxel-line-height-sm);
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .key-meta {
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      color: var(--muted-foreground);
    }
  </style>
</template>;

export default KeyTile;
