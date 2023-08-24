import GlimmerComponent from '@glimmer/component';
import { startCase } from 'lodash';
import type { BaseDef } from './card-api';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { FieldContainer } from '@cardstack/boxel-ui';

class DefaultTemplate extends GlimmerComponent<{
  Args: {
    model: BaseDef;
    fields: Record<string, new () => GlimmerComponent>;
  };
}> {
  <template>
    <div class='default-card-template'>
      {{#each-in @fields as |key Field|}}
        {{#unless (eq key 'id')}}
          <FieldContainer
            {{! @glint-ignore (glint is arriving at an incorrect type signature for 'startCase') }}
            @label={{startCase key}}
            data-test-field={{key}}
          >
            <Field />
          </FieldContainer>
        {{/unless}}
      {{/each-in}}
    </div>
    <style>
      .default-card-template {
        display: grid;
        gap: var(--boxel-sp-lg);
      }
    </style>
  </template>
}

export const defaultComponent = {
  embedded: <template>
    <!-- Inherited from base card embedded view. Did your card forget to specify its embedded component? -->
  </template>,
  isolated: DefaultTemplate,
  edit: DefaultTemplate,
};
