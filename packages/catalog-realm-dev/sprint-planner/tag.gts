import { Pill } from '@cardstack/boxel-ui/components';
import TagIcon from '@cardstack/boxel-icons/tag';
import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import ColorField from 'https://cardstack.com/base/color';

export class Tag extends CardDef {
  static displayName = 'Tag';
  static icon = TagIcon;
  @field name = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: Tag) {
      return this.name;
    },
  });
  @field color = contains(ColorField);

  static atom = class Atom extends Component<typeof this> {
    <template>
      {{#if @model.name}}
        <Pill class='tag-pill' @pillBackgroundColor={{@model.color}}>
          <:default>
            <span># {{@model.name}}</span>
          </:default>
        </Pill>
      {{/if}}

      <style scoped>
        .tag-pill {
          font-size: calc(var(--boxel-font-size-xs) * 0.95);
          font-weight: 500;
          padding: 0;
          --pill-font-color: var(--boxel-400);
          border: none;
        }
      </style>
    </template>
  };
}
