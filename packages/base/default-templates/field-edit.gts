import GlimmerComponent from '@glimmer/component';
import type { FieldDef } from '../card-api';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { startCase } from 'lodash';
import { getField } from '@cardstack/runtime-common';

export default class FieldDefEditTemplate extends GlimmerComponent<{
  Args: {
    model: FieldDef;
    fields: Record<string, new () => GlimmerComponent>;
  };
}> {
  getFieldIcon = (key: string) => {
    return getField(this.args.model.constructor, key)?.card?.icon;
  };
  <template>
    <div class='field-def-edit-template'>
      {{#each-in @fields as |key Field|}}
        {{#unless (eq key 'id')}}
          <FieldContainer
            {{! @glint-ignore (glint is arriving at an incorrect type signature for 'startCase') }}
            @label={{startCase key}}
            @icon={{this.getFieldIcon key}}
            @vertical={{true}}
            data-test-field={{key}}
          >
            <Field />
          </FieldContainer>
        {{/unless}}
      {{/each-in}}
    </div>
    <style scoped>
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
