// A key's icon in a tile tinted by whose key it is, so a key read on its own
// still says it: gray for one of the user's own keys, the info tone for a key
// shared with a workspace, as the key sections' discs are. A small badge on
// its corner names the owner too: one person for the user's own key, a group
// for a shared one.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import KeyRound from '@cardstack/boxel-icons/key-round';
import User from '@cardstack/boxel-icons/user';
import Users from '@cardstack/boxel-icons/users';

import cn from '../../helpers/cn.ts';

interface Signature {
  Args: { shared?: boolean };
  Element: HTMLSpanElement;
}

const KeyMark: TemplateOnlyComponent<Signature> = <template>
  <span
    class={{cn 'key-mark' shared=@shared}}
    aria-hidden='true'
    data-test-key-mark={{if @shared 'shared' 'own'}}
    ...attributes
  >
    <KeyRound class='key-mark-icon' />
    <span class='owner-badge'>
      {{#if @shared}}
        <Users class='owner-icon' />
      {{else}}
        <User class='owner-icon' />
      {{/if}}
    </span>
  </span>

  <style scoped>
    .key-mark {
      position: relative;
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
    .shared {
      background-color: color-mix(in oklch, var(--info) 18%, var(--card));
      color: var(--info-ink);
    }
    .key-mark-icon {
      width: 1.25rem;
      height: 1.25rem;
    }
    .owner-badge {
      position: absolute;
      inset-block-end: -0.3rem;
      inset-inline-end: -0.3rem;
      display: grid;
      place-items: center;
      width: 1.25rem;
      height: 1.25rem;
      border-radius: 50%;
      background-color: var(--foreground);
      color: var(--background);
      box-shadow: 0 0 0 2px var(--card);
    }
    .shared .owner-badge {
      background-color: var(--info);
      color: var(--info-foreground);
    }
    .owner-icon {
      width: 0.75rem;
      height: 0.75rem;
    }
  </style>
</template>;

export default KeyMark;
