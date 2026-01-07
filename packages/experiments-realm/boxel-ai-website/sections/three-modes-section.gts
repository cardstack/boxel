import {
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import ColorField from 'https://cardstack.com/base/color';
import URLField from 'https://cardstack.com/base/url';

import { cssVar, sanitizeHtml } from '@cardstack/boxel-ui/helpers';

import { Section, SectionCardComponent } from '../components/section';
import { SectionCard } from './section-card';

class ModeCardField extends FieldDef {
  static displayName = 'Mode Card';

  @field modeNumber = contains(StringField);
  @field modeLabel = contains(StringField);
  @field headline = contains(StringField);
  @field subheadline = contains(StringField);
  @field body = contains(StringField);
  @field screenshotUrl = contains(URLField);
  @field linkText = contains(StringField);
  @field linkUrl = contains(URLField);
  @field isHighlighted = contains(BooleanField);
  @field accentColor = contains(ColorField);

  static embedded = class Embedded extends Component<typeof this> {
    private get badgeLabel() {
      return [this.args.model?.modeLabel, this.args.model?.modeNumber]
        .map((l) => l?.trim())
        .filter(Boolean)
        .join(' ');
    }

    <template>
      <SectionCardComponent
        @accentColor={{@model.accentColor}}
        @badgeLabel={{this.badgeLabel}}
        @title={{@model.headline}}
        @text={{@model.body}}
      >
        <:before>
          <span
            class='mode-indicator'
            style={{cssVar indicator-color=@model.accentColor}}
          />
        </:before>
        <:footer>
          <a
            href={{if @model.linkUrl (sanitizeHtml @model.linkUrl) '/'}}
            class='mode-card-link'
            style={{cssVar
              link-color=(if @model.isHighlighted @model.accentColor)
            }}
          >
            {{@model.linkText}}
          </a>
        </:footer>
      </SectionCardComponent>
      <style scoped>
        .mode-indicator {
          display: inline-block;
          width: 4rem;
          height: 0.375rem;
          border-radius: 3px;
          background-color: var(--indicator-color, var(--boxel-highlight));
        }
        .mode-card-link {
          display: block;
          color: var(--link-color);
          font-family: var(--font-mono, var(--boxel-monospace-font-family));
          font-size: 0.85rem;
          text-decoration: none;
        }
      </style>
    </template>
  };

  static fitted = this.embedded;
}

export class ThreeModesSection extends SectionCard {
  static displayName = 'Three Modes';

  @field headline = contains(StringField);
  @field subheadline = contains(StringField);
  @field modes = containsMany(ModeCardField);

  /** Template Features:
   * Three expandable cards
   * Hover to expand with screenshot reveal
   * Color-coded mode indicators
   * Staggered grid layout
   * */

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <Section class='section-isolated' as |s|>
        <s.Header
          @headline={{@model.headline}}
          @subheadline={{@model.subheadline}}
          @label={{@model.headerLabel}}
          @type='row'
        />

        {{#if @model.modes.length}}
          <s.Grid>
            <@fields.modes />
          </s.Grid>
        {{/if}}
      </Section>
    </template>
  };
}
