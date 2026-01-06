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

import { cn } from '@cardstack/boxel-ui/helpers';

import { SectionCardComponent } from '../components/section';
import { SkillFlowStep } from '../components/skill-flow-step';

export class FlowStepField extends FieldDef {
  static displayName = 'Flow Step';

  @field stepIcon = contains(StringField);
  @field stepLabel = contains(StringField);
  @field stepDetail = contains(StringField);
  @field isAiAction = contains(BooleanField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <SkillFlowStep
        @icon={{@model.stepIcon}}
        @title={{@model.stepLabel}}
        @description={{@model.stepDetail}}
      />
    </template>
  };

  static fitted = this.embedded;
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
  @field isHighlighted = contains(BooleanField);
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
        class={{cn 'flow-tab' flow-tab--accent=@model.isHighlighted}}
        @accentColor={{@model.accentColor}}
        @badgeLabel={{this.badgeLabel}}
        @title={{@model.headline}}
        @text={{@model.body}}
        @isHighlighted={{@model.isHighlighted}}
      >
        <:footer>
          {{#if @model.footerNote}}
            <small class='footer-note'>
              <@fields.footerNote />
            </small>
          {{/if}}
        </:footer>
      </SectionCardComponent>

      <style scoped>
        small {
          display: inline-block;
        }
        .footer-note {
          color: var(--secondary);
        }
        .flow-tab--accent .footer-note {
          color: var(--accent-foreground);
        }
      </style>
    </template>
  };

  static fitted = this.embedded;
}
