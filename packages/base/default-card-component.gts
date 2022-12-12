import GlimmerComponent from '@glimmer/component';
import { startCase } from 'lodash';
import type { Card } from './card-api';
import { CardContainer, Label } from '@cardstack/boxel-ui';

class DefaultIsolated extends GlimmerComponent<{ Args: { model: Card; fields: Record<string, new() => GlimmerComponent>}}> {
  <template>
    <CardContainer>
      {{#each-in @fields as |key Field|}}
        {{#unless (eq key 'id')}}
          <Field />
        {{/unless}}
      {{/each-in}}
    </CardContainer>
  </template>;
}

class DefaultEdit extends GlimmerComponent<{ Args: { model: Card; fields: Record<string, new() => GlimmerComponent>}}> {
  <template>
    <CardContainer>
      {{#each-in @fields as |key Field|}}
        {{#unless (eq key 'id')}}
          {{!-- @glint-ignore glint is arriving at an incorrect type signature --}}
          <Label @label={{startCase key}} data-test-field={{key}}>
            <Field />
          </Label>
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

function eq<T>(a: T, b: T, _namedArgs: unknown): boolean {
  return a === b;
}
