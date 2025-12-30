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

import { cssVar } from '@cardstack/boxel-ui/helpers';

import { SectionCardComponent } from '../components/section';

export class FlowStepField extends FieldDef {
  static displayName = 'Flow Step';

  @field stepIcon = contains(StringField);
  @field stepLabel = contains(StringField);
  @field stepDetail = contains(StringField);
  @field isAiAction = contains(BooleanField);
}

export class FlowTabField extends FieldDef {
  static displayName = 'Flow Tab';

  @field tabIcon = contains(StringField);
  @field tabLabel = contains(StringField);
  @field methodBadge = contains(StringField);
  @field headline = contains(StringField);
  @field body = contains(StringField);
  @field bullets = containsMany(StringField);
  @field flowSteps = containsMany(FlowStepField);
  @field footerNote = contains(StringField);
  @field accentColor = contains(ColorField);

  static embedded = class Embedded extends Component<typeof this> {
    private get badgeLabel() {
      return [this.args.model?.tabIcon, this.args.model?.tabLabel]
        .map((l) => l?.trim())
        .filter(Boolean)
        .join(' ');
    }

    <template>
      <SectionCardComponent
        class='flow-tab'
        style={{cssVar tab-background=@model.accentColor}}
        @accentColor={{@model.accentColor}}
        @badgeLabel={{this.badgeLabel}}
        @title={{@model.headline}}
        @text={{@model.body}}
      >
        {{#if @model.footerNote.length}}
          <footer class='footer-note'>
            <@fields.footerNote />
          </footer>
        {{/if}}
      </SectionCardComponent>

      <style scoped>
        .flow-tab {
          background-color: var(--tab-background, var(--card));
        }
        .footer-note {
          margin-top: var(--boxel-sp);
          font-size: var(--boxel-font-size-xs);
        }
      </style>
    </template>
  };

  static fitted = this.embedded;
}
