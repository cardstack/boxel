// One of the user's keys, drawn as a linked card is in a linksToMany field: a
// bordered tile with the key's icon, its name and when it was added. Nothing
// about its value is shown. Every key is the one kind there is, a secret
// pasted in, so the tile doesn't name its kind.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import KeyRound from '../../components/icons/key-round.gts';

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

interface Signature {
  Args: { key: UserKey };
  Blocks: { default: [] };
  Element: HTMLElement;
}

const KeyTile: TemplateOnlyComponent<Signature> = <template>
  <div class='key-tile' ...attributes>
    <span class='key-icon' aria-hidden='true'><KeyRound /></span>
    <div class='key-text'>
      <div class='key-name' data-test-key-row-name>{{@key.name}}</div>
      <div class='key-meta'>Added {{addedOn @key.createdAt}}</div>
    </div>
    {{yield}}
  </div>

  <style scoped>
    .key-tile {
      display: flex;
      align-items: center;
      gap: var(--boxel-sp-sm);
      min-height: 4rem;
      padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      background-color: var(--card, var(--background));
      color: var(--card-foreground, var(--foreground));
      border-radius: var(--boxel-border-radius);
      box-shadow: 0 0 0 1px var(--border);
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
      flex: 1;
      min-width: 0;
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
