import GlimmerComponent from '@glimmer/component';
import type { CardContext, BaseDef, CardDef, Format } from '../card-api';
// @ts-ignore no types
import cssUrl from 'ember-css-url';
import { identifyCard, isCardDef, moduleFrom } from '@cardstack/runtime-common';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { Button } from '@cardstack/boxel-ui/components';

export default class MissingTemplate extends GlimmerComponent<{
  Args: {
    cardOrField: typeof BaseDef;
    model: CardDef;
    fields: Record<string, new () => GlimmerComponent>;
    context?: CardContext;
    format: Format;
  };
}> {
  <template>
    <div
      class='missing-template
        {{if (isCardDef @cardOrField) "card" "field"}}
        {{@format}}
        '
    >
      <span data-test-missing-template-text={{@format}}>
        Missing
        {{@format}}
        component for
        {{if (isCardDef @cardOrField) 'CardDef' 'FieldDef'}}:
        {{@cardOrField.displayName}}
      </span>
      {{#if @context.actions.changeSubmode}}
        <Button
          class='open-code-submode'
          @kind='secondary-light'
          @size='tall'
          {{on 'click' this.openCodeSubmode}}
          data-test-open-code-submode
        >
          Open in Code Mode
        </Button>
      {{/if}}
    </div>
    <style scoped>
      .missing-template {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        box-sizing: border-box;
        min-height: 3.75rem;
        padding: var(--boxel-sp);
        background-color: var(--boxel-100);
        border: none;
        border-radius: var(--boxel-form-control-border-radius);
        color: var(--boxel-dark);
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        transition: background-color var(--boxel-transition);
      }
      .card {
        width: calc(100% + calc(2 * var(--boxel-sp)));
        margin: calc(-1 * var(--boxel-sp));
      }
      .field {
        width: 100%;
        margin: 0;
      }
      .field.fitted {
        height: 100%;
        font: 500 var(--boxel-font-xs);
        padding: 0 var(--boxel-sp-5xs);
        min-height: auto;
      }
      .open-code-submode {
        margin-top: var(--boxel-sp-sm);
      }
    </style>
  </template>

  @action
  openCodeSubmode() {
    let ref = identifyCard(this.args.cardOrField);
    if (!ref) {
      return;
    }
    let moduleId = moduleFrom(ref);
    this.args.context?.actions?.changeSubmode(new URL(moduleId), 'code');
  }
}
