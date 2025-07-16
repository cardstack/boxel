import BooleanField from './boolean';
import { CardDef, StringField, contains, field, Component } from './card-api';
import ColorField from './color';
import TagIcon from '@cardstack/boxel-icons/tag';
import {
  BoxelContainer,
  FieldContainer,
  BoxelTag,
} from '@cardstack/boxel-ui/components';

class View extends Component<typeof Tag> {
  <template>
    <BoxelTag
      @ellipsize={{@model.ellipsize}}
      @name={{@model.name}}
      @pillColor={{@model.color}}
      @borderColor={{@model.borderColor}}
      @fontColor={{@model.fontColor}}
    />
  </template>
}

export default class Tag extends CardDef {
  static displayName = 'Tag';
  static icon = TagIcon;
  @field name = contains(StringField);
  @field ellipsize = contains(BooleanField);
  @field title = contains(StringField, {
    computeVia: function (this: Tag) {
      return this.name;
    },
  });
  @field color = contains(ColorField);
  @field fontColor = contains(ColorField);
  @field borderColor = contains(ColorField);

  static atom = View;
  static embedded = View;
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <BoxelContainer>
        <BoxelTag
          @ellipsize={{@model.ellipsize}}
          @name={{@model.name}}
          @pillColor={{@model.color}}
          @borderColor={{@model.borderColor}}
          @fontColor={{@model.fontColor}}
        />
        <h3><@fields.title /></h3>
        <div class='label'>Tag</div>
        <p><@fields.description /></p>
      </BoxelContainer>
      <style scoped>
        h3 {
          margin-bottom: 0;
          font-weight: 600;
        }
        .label {
          color: var(--boxel-450);
          font: 500 var(--boxel-font-xs);
          letter-spacing: var(--boxel-lsp-sm);
        }
      </style>
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelContainer @display='grid'>
        <FieldContainer @label='Preview'>
          <div>
            <BoxelTag
              @ellipsize={{@model.ellipsize}}
              @name={{@model.name}}
              @pillColor={{@model.color}}
              @borderColor={{@model.borderColor}}
              @fontColor={{@model.fontColor}}
            />
          </div>
        </FieldContainer>
        <FieldContainer @label='Name' @tag='label'>
          <@fields.name />
        </FieldContainer>
        <FieldContainer @label='Description' @tag='label'>
          <@fields.description />
        </FieldContainer>
        <FieldContainer @label='Pill Color' @tag='label'>
          <@fields.color />
        </FieldContainer>
      </BoxelContainer>
    </template>
  };
}
