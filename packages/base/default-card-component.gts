
import GlimmerComponent from '@glimmer/component';
import { initStyleSheet, attachStyles } from './attach-styles';
import { startCase } from 'lodash';
import type { Card } from './card-api';
import BoxelField from './components/boxel-field';

let defaultStyles = initStyleSheet(`
  this {
    border: 1px solid gray;
    border-radius: 10px;
    background-color: #fff;
    padding: 1rem;
  }
`);

let editStyles = initStyleSheet(`
  this {
    border: 1px solid gray;
    border-radius: 10px;
    background-color: #fff;
    padding: 1rem;
  }
  textarea {
    box-sizing: border-box;
    background-color: transparent;
    width: 100%;
    min-height: 5rem;
    margin-top: .5rem;
    display: block;
    padding: 0.5rem;
    font: inherit;
    border: inherit;
  }
`);

class DefaultIsolated extends GlimmerComponent<{ Args: { model: Card; fields: Record<string, new() => GlimmerComponent>}}> {
  <template>
    <div {{attachStyles defaultStyles}}>
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
    <div {{attachStyles editStyles}}>
      {{#each-in @fields as |key Field|}}
        {{#unless (eq key 'id')}}
          <BoxelField @label={{startCase key}} class="edit-field" data-test-field={{key}}>
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
