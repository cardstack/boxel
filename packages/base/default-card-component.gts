import GlimmerComponent from '@glimmer/component';
import { startCase } from 'lodash';
import type { Primitive } from './card-api';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { CardContainer, FieldContainer } from '@cardstack/boxel-ui';

class DefaultIsolated extends GlimmerComponent<{
  Args: {
    model: Primitive;
    fields: Record<string, new () => GlimmerComponent>;
  };
}> {
  <template>
    <CardContainer class='isolated-card' @displayBoundaries={{true}}>
      {{#each-in @fields as |key Field|}}
        {{#unless (eq key 'id')}}
          <Field />
        {{/unless}}
      {{/each-in}}
    </CardContainer>
  </template>
}

class DefaultEdit extends GlimmerComponent<{
  Args: {
    model: Primitive;
    fields: Record<string, new () => GlimmerComponent>;
  };
}> {
  <template>
    <CardContainer class='isolated-card' @displayBoundaries={{true}}>
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
    </CardContainer>
  </template>
}

export const defaultComponent = {
  embedded: <template>
    <!-- Inherited from base card embedded view. Did your card forget to specify its embedded component? -->
  </template>,
  isolated: DefaultIsolated,
  edit: DefaultEdit,
};
