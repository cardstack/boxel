import GlimmerComponent from '@glimmer/component';
import { initStyleSheet, attachStyles } from './attach-styles';
import { startCase } from 'lodash';
import type { Card } from './card-api';
import { BoxelField } from '@cardstack/boxel-ui';

let styles = initStyleSheet(`
  this {
    --boxel-field-label-align: center;
    border: 1px solid gray;
    border-radius: 10px;
    background-color: #fff;
    padding: 1rem;
  }
`);

class DefaultIsolated extends GlimmerComponent<{ Args: { model: Card; fields: Record<string, new() => GlimmerComponent>}}> {
  <template>
    <div {{attachStyles styles}}>
      {{#each-in @fields as |key Field|}}
        {{#unless (eq key 'id')}}
          <Field />
        {{/unless}}
      {{/each-in}}
    </div>
  </template>;
}

class DefaultEdit extends GlimmerComponent<{ Args: { model: Card; fields: Record<string, new() => GlimmerComponent>}}> {
  <template>
    <div {{attachStyles styles}}>
      {{#each-in @fields as |key Field|}}
        {{#unless (eq key 'id')}}
          {{!-- @glint-ignore glint is arriving at an incorrect type signature --}}
          <BoxelField @label={{startCase key}} data-test-field={{key}}>
            <Field />
          </BoxelField>
        {{/unless}}
      {{/each-in}}
    </div>
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
