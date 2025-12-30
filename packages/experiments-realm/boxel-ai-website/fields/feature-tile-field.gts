import {
  Component,
  CardDef,
  FieldDef,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import ColorField from 'https://cardstack.com/base/color';
import MarkdownField from 'https://cardstack.com/base/markdown';

import { SectionCardComponent } from '../components/section';

export class FeatureTileField extends FieldDef {
  static displayName = 'Feature Tile';

  @field tileNumber = contains(StringField);
  @field tileLabel = contains(StringField);
  @field headline = contains(StringField);
  @field body = contains(StringField);
  @field markdown = contains(MarkdownField);
  @field linkedCard = linksTo(() => CardDef);
  @field accentColor = contains(ColorField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <SectionCardComponent
        @accentColor={{@model.accentColor}}
        @badgeLabel={{@model.tileLabel}}
        @title={{@model.headline}}
        @text={{@model.body}}
      >
        {{#if @model.markdown.length}}
          <div class='tile-markdown'>
            <@fields.markdown />
          </div>
        {{/if}}
      </SectionCardComponent>

      <style scoped>
        .tile-markdown {
          margin-top: var(--boxel-sp);
        }
        :deep(code) {
          display: block;
          border: 1px solid var(--border);
          border-radius: var(--boxel-border-radius-sm);
          font-size: var(--boxel-caption-font-size);
          padding: 1.25rem;
          text-align: center;
        }
      </style>
    </template>
  };

  static fitted = this.embedded;
}
