import GlimmerComponent from '@glimmer/component';
import type { CardContext, BaseDef, CardDef } from '../card-api';
// @ts-ignore no types
import cssUrl from 'ember-css-url';
import { identifyCard, isCardDef, moduleFrom } from '@cardstack/runtime-common';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

export default class MissingEmbeddedTemplate extends GlimmerComponent<{
  Args: {
    cardOrField: typeof BaseDef;
    model: CardDef;
    fields: Record<string, new () => GlimmerComponent>;
    context?: CardContext;
  };
}> {
  <template>
    <div
      class='missing-embedded-template
        {{if (isCardDef @cardOrField) "card" "field"}}'
    >
      <span data-test-missing-embedded-template-text>Missing embedded component
        for
        {{if (isCardDef @cardOrField) 'CardDef' 'FieldDef'}}:
        {{@cardOrField.displayName}}</span>
      {{#if @context.actions.changeSubmode}}
        <span
          class='open-code-submode'
          {{on 'click' this.openCodeSubmode}}
          data-test-open-code-submode
        >
          Open In Code Mode
        </span>
      {{/if}}
    </div>
    <style>
      .missing-embedded-template {
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
        font: 700 var(--boxel-font-sm);
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
      .open-code-submode {
        cursor: pointer;
        color: var(--boxel-highlight);
      }
      .open-code-submode:hover {
        text-decoration: underline;
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
