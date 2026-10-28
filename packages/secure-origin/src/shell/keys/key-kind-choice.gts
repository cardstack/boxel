// What kind of key is being entered, as a row of a card's edit format: a key
// pasted in as it is (an API key or token), or a Google service account's
// JSON key file, from which the platform mints the short-lived tokens Google's
// APIs take. A radio group, so the arrow keys and screen readers work as for
// any other.
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import FieldContainer from '../../components/field-container.gts';
import RectangleEllipsis from '../../components/icons/rectangle-ellipsis.gts';
import { eq } from '../../helpers/truth-helpers.ts';

import type { KeyKind } from './context.ts';

interface Signature {
  Args: {
    kind: KeyKind;
    onKind: (kind: KeyKind) => void;
  };
}

const KeyKindChoice: TemplateOnlyComponent<Signature> = <template>
  <FieldContainer
    @tag='div'
    @label='Kind'
    @icon={{RectangleEllipsis}}
    data-test-key-field='kind'
  >
    <fieldset class='kinds'>
      <legend class='visually-hidden'>Kind of key</legend>
      <label class='kind' data-test-key-kind='static'>
        <input
          type='radio'
          name='key-kind'
          value='static'
          checked={{eq @kind 'static'}}
          {{on 'change' (fn @onKind 'static')}}
        />
        <span class='text'>
          <span class='title'>API key or token</span>
          <span class='detail'>Sent as it is, in the place the card declares.</span>
        </span>
      </label>
      <label class='kind' data-test-key-kind='google-service-account'>
        <input
          type='radio'
          name='key-kind'
          value='google-service-account'
          checked={{eq @kind 'google-service-account'}}
          {{on 'change' (fn @onKind 'google-service-account')}}
        />
        <span class='text'>
          <span class='title'>Google service account</span>
          <span class='detail'>Its JSON key file. Boxel sends Google only a
            short-lived token made from it, never the key itself.</span>
        </span>
      </label>
    </fieldset>
  </FieldContainer>

  <style scoped>
    .kinds {
      margin: 0;
      padding: 0;
      border: 0;
      display: grid;
      gap: var(--boxel-sp-xs);
      min-width: 0;
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .kind {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: start;
      column-gap: var(--boxel-sp-xs);
      padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      border-radius: var(--boxel-border-radius);
      box-shadow: 0 0 0 1px var(--border);
      cursor: pointer;
    }
    .kind:hover {
      box-shadow: 0 0 0 1px var(--foreground, var(--boxel-dark));
    }
    .kind:has(input:checked) {
      box-shadow: 0 0 0 2px var(--primary, var(--boxel-highlight));
    }
    .kind:has(input:focus-visible) {
      outline: 2px solid var(--ring, var(--boxel-highlight));
      outline-offset: 2px;
    }
    .kind input {
      margin: 0.2rem 0 0;
      accent-color: var(--primary, var(--boxel-highlight));
    }
    .text {
      display: grid;
    }
    .title {
      font-size: var(--boxel-font-size-sm);
      line-height: var(--boxel-line-height-sm);
      font-weight: 600;
    }
    .detail {
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      color: var(--muted-foreground);
    }
  </style>
</template>;

export default KeyKindChoice;
