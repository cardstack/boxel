// Picks one of the user's keys, as a row of a card's edit format: each key a
// tile to click. Each tile is a radio choice whose radio button is hidden, so
// the arrow keys and screen readers work as for any radio group, and the
// chosen tile is outlined. A "Select a key" prompt heads the tiles when there
// is more than one to choose from; a single key is chosen already. Adding a
// key is a change of its own, made on the key page, so with no keys this says
// to add one there first. Nothing names a key but the user: the page that
// opened the window never does.
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import Button from '../../components/button.gts';
import FieldContainer from '../../components/field-container.gts';
import KeyRound from '../../components/icons/key-round.gts';
import { eq, gt } from '../../helpers/truth-helpers.ts';

import type { UserKey } from './context.ts';
import KeyTile from './key-tile.gts';

interface Signature {
  Args: {
    keys: UserKey[];
    // A key's id.
    selected: string | undefined;
    onSelect: (selected: string) => void;
    onGoToKeys: () => void;
  };
}

const KeyPicker: TemplateOnlyComponent<Signature> = <template>
  <FieldContainer
    @tag='div'
    @label='Key'
    @icon={{KeyRound}}
    data-test-key-picker
  >
    <fieldset class='picker'>
      <legend
        class={{if (gt @keys.length 1) 'prompt' 'visually-hidden'}}
        data-test-key-picker-prompt
      >Select a key</legend>
      {{#each @keys as |key|}}
        <label class='choice' data-test-key-choice={{key.name}}>
          <input
            type='radio'
            name='key'
            value={{key.id}}
            checked={{eq @selected key.id}}
            {{on 'change' (fn @onSelect key.id)}}
          />
          <KeyTile class='tile' @key={{key}} />
        </label>
      {{else}}
        <p class='empty' data-test-key-picker-empty>You haven’t added any keys
          yet. Add one on your key page first, then share it from there.</p>
        <Button
          class='go-to-keys'
          type='button'
          @kind='secondary'
          data-test-key-picker-go-to-keys
          {{on 'click' @onGoToKeys}}
        >Go to your keys</Button>
      {{/each}}
    </fieldset>
  </FieldContainer>

  <style scoped>
    .picker {
      margin: 0;
      padding: 0;
      border: 0;
      display: grid;
      gap: var(--boxel-sp-xs);
      min-width: 0;
    }
    .prompt {
      padding: 0;
      margin-bottom: var(--boxel-sp-xs);
      font-size: var(--boxel-font-size-sm);
      line-height: var(--boxel-line-height-sm);
      color: var(--muted-foreground);
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .choice {
      position: relative;
      display: block;
      cursor: pointer;
    }
    .choice input {
      position: absolute;
      opacity: 0;
      width: 1px;
      height: 1px;
      margin: 0;
    }
    .choice:hover .tile {
      box-shadow: 0 0 0 1px var(--foreground, var(--boxel-dark));
    }
    .choice:has(input:checked) .tile {
      box-shadow: 0 0 0 2px var(--primary, var(--boxel-highlight));
    }
    .choice:has(input:focus-visible) .tile {
      outline: 2px solid var(--ring, var(--boxel-highlight));
      outline-offset: 2px;
    }
    .empty {
      margin: 0;
      font-size: var(--boxel-font-size-sm);
      line-height: var(--boxel-line-height-sm);
      color: var(--muted-foreground);
    }
    .go-to-keys {
      width: fit-content;
    }
  </style>
</template>;

export default KeyPicker;
