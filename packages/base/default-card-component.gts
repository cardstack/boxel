import GlimmerComponent from '@glimmer/component';
import { startCase } from 'lodash';
import type { Card } from './card-api';
import { initStyleSheet, attachStyles } from '@cardstack/boxel-ui/attach-styles';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { CardContainer, FieldContainer } from '@cardstack/boxel-ui';

let styles = initStyleSheet(`
  this {
    padding: var(--boxel-sp);
  }
`);

class DefaultIsolated extends GlimmerComponent<{ Args: { model: Card; fields: Record<string, new() => GlimmerComponent>}}> {
  <template>
    <CardContainer @displayBoundaries={{true}} {{attachStyles styles}}>
      {{#each-in @fields as |key Field|}}
        {{#unless (eq key 'id')}}
          <Field />
        {{/unless}}
      {{/each-in}}
    </CardContainer>
  </template>;
}

let editStyles = initStyleSheet(`
  this {
    padding: var(--boxel-sp);
    display: grid;
    gap: var(--boxel-sp);
  }
`);

class DefaultEdit extends GlimmerComponent<{ Args: { model: Card; fields: Record<string, new() => GlimmerComponent>}}> {
  <template>
    <CardContainer @displayBoundaries={{true}} {{attachStyles editStyles}}>
      {{#each-in @fields as |key Field|}}
        {{#unless (eq key 'id')}}
          {{!-- @glint-ignore (glint is arriving at an incorrect type signature for 'startCase') --}}
          <FieldContainer @vertical={{true}} @label={{startCase key}} data-test-field={{key}}>
            <Field />
          </FieldContainer>
        {{/unless}}
      {{/each-in}}
    </CardContainer>
  </template>;
}

export const defaultComponent = {
  embedded: <template><!-- Inherited from base card embedded view. Did your card forget to specify its embedded component? --></template>,
  isolated: DefaultIsolated,
  edit: DefaultEdit,
}
