import BooleanField from './boolean';
import { CardDef, StringField, contains, field, Component } from './card-api';
import ColorField from './color';
import TagIcon from '@cardstack/boxel-icons/tag';
import {
  BoxelContainer,
  FieldContainer,
  BoxelTag,
} from '@cardstack/boxel-ui/components';
import { getFieldIcon } from '@cardstack/runtime-common';

class TagTemplate extends Component<typeof Tag> {
  <template>
    <BoxelContainer>
      <BoxelTag
        @ellipsize={{@model.ellipsize}}
        @name={{@model.name}}
        @pillColor={{@model.color}}
        @borderColor={{@model.borderColor}}
        @fontColor={{@model.fontColor}}
      />
      <div class='label'>{{@model.constructor.displayName}}</div>
      <h3 class='title'><@fields.cardTitle /></h3>
      <p class='description'><@fields.cardDescription /></p>
    </BoxelContainer>
    <style scoped>
      .label {
        margin-top: var(--boxel-sp);
        color: var(--boxel-450);
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
      }
      .title {
        margin-block: 0;
        font-weight: 600;
      }
      .description {
        margin-top: var(--boxel-sp-sm);
        font: 400 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
      }
    </style>
  </template>
}

export default class Tag extends CardDef {
  static displayName = 'Tag';
  static icon = TagIcon;
  @field name = contains(StringField);
  @field ellipsize = contains(BooleanField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Tag) {
      return this.name;
    },
  });
  @field color = contains(ColorField);
  @field fontColor = contains(ColorField);
  @field borderColor = contains(ColorField);

  static atom = class Atom extends Component<typeof Tag> {
    <template>
      <BoxelTag
        @ellipsize={{@model.ellipsize}}
        @name={{@model.name}}
        @pillColor={{@model.color}}
        @borderColor={{@model.borderColor}}
        @fontColor={{@model.fontColor}}
      />
    </template>
  };
  static embedded = TagTemplate;
  static isolated = TagTemplate;
  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelContainer @display='grid'>
        <FieldContainer
          @label='Name'
          @tag='label'
          @icon={{getFieldIcon @model 'name'}}
        >
          <@fields.name />
        </FieldContainer>
        <FieldContainer
          @label='Description'
          @tag='label'
          @icon={{getFieldIcon @model 'cardDescription'}}
        >
          <@fields.cardDescription />
        </FieldContainer>
        <FieldContainer
          @label='Pill Color'
          @tag='label'
          @icon={{getFieldIcon @model 'color'}}
        >
          <@fields.color />
        </FieldContainer>
      </BoxelContainer>
    </template>
  };
}
