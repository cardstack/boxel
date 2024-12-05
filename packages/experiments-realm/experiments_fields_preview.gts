import { ContactLinkField } from './fields/contact-link';
import { EmailField } from './email';
import { UrlField } from './url';
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
import { eq } from '@cardstack/boxel-ui/helpers';
import { getField } from '@cardstack/runtime-common';
import { startCase } from 'lodash';

export class ExperimentsFieldsPreview extends CardDef {
  @field url = contains(UrlField);
  @field urls = containsMany(UrlField);
  @field email = contains(EmailField);
  @field emails = containsMany(EmailField);
  @field contactLink = contains(ContactLinkField);
  @field contactLinks = containsMany(ContactLinkField);
  static displayName = 'Custom Fields ';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        {{#each-in @fields as |key Field|}}
          {{#unless (eq key 'id')}}
            <FieldContainer
              @label={{startCase key}}
              @icon={{this.getFieldIcon key}}
            >
              <FieldContainer @vertical={{true}} @label='Atom'>
                <Field @format='atom' />
              </FieldContainer>
              <FieldContainer @vertical={{true}} @label='Embedded'>
                <Field @format='embedded' />
              </FieldContainer>
            </FieldContainer>
          {{/unless}}
        {{/each-in}}
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
