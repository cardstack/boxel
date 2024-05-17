import GlimmerComponent from '@glimmer/component';
import { type FieldDef } from '../-field-def';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

export class FieldDefEditTemplate extends GlimmerComponent<{
  Args: {
    model: FieldDef;
    fields: Record<string, new () => GlimmerComponent>;
  };
}> {
  <template>
    <div class='field-def-edit-template'>
      {{#each-in @fields as |key Field|}}
        {{#unless (eq key 'id')}}
          <FieldContainer
            {{! @glint-ignore (glint is arriving at an incorrect type signature for 'startCase') }}
            @label={{startCase key}}
            @vertical={{true}}
            data-test-field={{key}}
          >
            <Field />
          </FieldContainer>
        {{/unless}}
      {{/each-in}}
    </div>
    <style>
      .field-def-edit-template {
        display: grid;
        gap: var(--boxel-sp-lg);
      }
      .field-def-edit-template :deep(.containsMany-field) {
        padding: var(--boxel-sp-xs);
        border: 1px solid var(--boxel-form-control-border-color);
        border-radius: var(--boxel-form-control-border-radius);
      }
      .field-def-edit-template :deep(.containsMany-field.empty::after) {
        display: block;
        content: 'None';
        color: var(--boxel-450);
      }
    </style>
  </template>
}
