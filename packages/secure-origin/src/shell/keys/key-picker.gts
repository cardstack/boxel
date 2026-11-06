// Picks one of the user's keys, as a row of a card's edit format: each key a
// radio tile to click. A "Select a key" prompt heads the tiles when there
// is more than one to choose from; a single key is chosen already. Adding a
// key is a change of its own, made on the key page, so with no keys this says
// to add one there first. Nothing names a key but the user: the page that
// opened the window never does.
import { on } from '@ember/modifier';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import Button from '../../components/button.gts';
import { Field } from '@cardstack/pretui/components/field';
import User from '@cardstack/boxel-icons/user';
import { RadioCard } from '@cardstack/pretui/components/radio-card';

import { gt } from '../../helpers/truth-helpers.ts';

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

// The keys as tiles to choose between, and the key a tile stands for.
const cardsOf = (keys: UserKey[]) =>
  keys.map(({ id, name }) => ({ value: id, title: name }));
const keyOf = (keys: UserKey[], id: string) =>
  keys.find((key) => key.id === id)!;
// '' rather than undefined when no key is chosen, so the tiles stay
// controlled: RadioCard takes an undefined @value as uncontrolled and would
// keep a pick of its own.
const controlled = (selected: string | undefined) => selected ?? '';

const KeyPicker: TemplateOnlyComponent<Signature> = <template>
  <Field
    @reserveMessage={{false}}
    @orientation='horizontal'
    @labelTag='span'
    @label='Key'
    @icon={{User}}
    data-test-key-picker
    as |_controlId _messageId labelId|
  >
    <div class='picker'>
      {{#if @keys.length}}
        {{#if (gt @keys.length 1)}}
          <p class='prompt' data-test-key-picker-prompt>Select a key</p>
        {{/if}}
        <RadioCard
          @name='key'
          @options={{cardsOf @keys}}
          @value={{controlled @selected}}
          @onValueChange={{@onSelect}}
          aria-labelledby={{labelId}}
          as |card|
        >
          {{#let (keyOf @keys card.value) as |key|}}
            <KeyTile
              @key={{key}}
              @framed={{false}}
              data-test-key-choice={{key.name}}
            />
          {{/let}}
        </RadioCard>
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
      {{/if}}
    </div>
  </Field>

  <style scoped>
    .picker {
      display: grid;
      gap: var(--boxel-sp-xs);
      min-width: 0;
    }
    .prompt {
      margin: 0;
      font-size: var(--boxel-font-size-sm);
      line-height: var(--boxel-line-height-sm);
      color: var(--muted-foreground);
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
