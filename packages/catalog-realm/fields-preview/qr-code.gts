import { QRField } from '../fields/qr-code';
import {
  CardDef,
  field,
  contains,
  linksTo,
  type BaseDefConstructor,
  type Field,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { getField } from '@cardstack/runtime-common';

export class QRCodePreview extends CardDef {
  @field linkedCard = linksTo(() => CardDef);
  @field qrCode = contains(QRField);
  @field qrCodeOfLinkedCard = contains(QRField, {
    computeVia: function (this: QRCodePreview) {
      return new QRField({ data: this.linkedCard?.id });
    },
  });

  static displayName = 'QR Code Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        {{#if @model.linkedCard}}
          <FieldContainer @label='Linked Card'>
            <@fields.linkedCard @format='embedded' />
          </FieldContainer>
        {{/if}}

        <@fields.qrCode @format='edit' />
        <FieldContainer @label='Embedded' @icon={{this.getFieldIcon 'qrCode'}}>
          <@fields.qrCode @format='embedded' />
          <@fields.qrCodeOfLinkedCard @format='embedded' />
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
