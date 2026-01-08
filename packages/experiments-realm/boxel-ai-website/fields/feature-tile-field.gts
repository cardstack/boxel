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

import { cssVar } from '@cardstack/boxel-ui/helpers';

import { SectionCardComponent } from '../components/section';
import { DiagramBox } from '../components/diagram-box';

export class FeatureTileField extends FieldDef {
  static displayName = 'Feature Tile';

  @field tileNumber = contains(StringField);
  @field tileLabel = contains(StringField);
  @field headline = contains(StringField);
  @field body = contains(StringField);
  @field content = contains(MarkdownField);
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
        {{#if @model.content}}
          <DiagramBox
            @highlightOnHover={{true}}
            class='diagram-content'
            style={{cssVar accent-color=@model.accentColor}}
          >
            <@fields.content />
          </DiagramBox>
        {{/if}}
      </SectionCardComponent>

      <style scoped>
        .diagram-content :deep(ul) {
          list-style-type: none;
          margin: 0;
          padding: 0;
          display: flex;
          justify-content: space-around;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        .diagram-content :deep(li strong) {
          color: var(--accent-color);
          font-weight: 500;
        }
      </style>
    </template>
  };

  static fitted = this.embedded;
}
