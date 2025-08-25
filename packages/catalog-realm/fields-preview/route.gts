import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { RouteField } from '../fields/route';

export class RoutePreview extends CardDef {
  @field route = contains(RouteField);

  static displayName = 'Route Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer @vertical={{true}} @label='Edit'>
          <@fields.route @format='edit' />
        </FieldContainer>
        <FieldContainer @vertical={{true}} @label='Atom'>
          <@fields.route @format='atom' />
        </FieldContainer>
        <FieldContainer @vertical={{true}} @label='Embedded'>
          <@fields.route @format='embedded' />
        </FieldContainer>
      </section>

      <style scoped>
        .fields {
          display: grid;
          gap: var(--boxel-sp-lg);
          padding: var(--boxel-sp-xl);
        }
      </style>
    </template>
  };
}
