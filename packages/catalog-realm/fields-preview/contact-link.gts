import { ContactLinkField } from '../fields/contact-link';

import {
  CardDef,
  field,
  contains,
  containsMany,
  type BaseDefConstructor,
  type Field,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { getField } from '@cardstack/runtime-common';

export class ContactLinkPreview extends CardDef {
  @field contactLink = contains(ContactLinkField);
  @field contactLinks = containsMany(ContactLinkField);

  static displayName = 'Contact Link Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='Contact Link'
          @icon={{this.getFieldIcon 'contactLink'}}
        >
          <FieldContainer @vertical={{true}} @label='Atom'>
            <@fields.contactLink @format='atom' />
          </FieldContainer>
          <FieldContainer @vertical={{true}} @label='Embedded'>
            <@fields.contactLink @format='embedded' />
          </FieldContainer>
        </FieldContainer>
        <FieldContainer
          @label='Contact Links'
          @icon={{this.getFieldIcon 'contactLinks'}}
        >
          <FieldContainer @vertical={{true}} @label='Atom'>
            <@fields.contactLinks @format='atom' />
          </FieldContainer>
          <FieldContainer @vertical={{true}} @label='Embedded'>
            <@fields.contactLinks @format='embedded' />
          </FieldContainer>
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
    getFieldIcon = (key: string) => {
      const field: Field<BaseDefConstructor> | undefined = getField(
        this.args.model.constructor!,
        key,
      );
      let fieldInstance = field?.card;
      return fieldInstance?.icon;
    };
  };
}
