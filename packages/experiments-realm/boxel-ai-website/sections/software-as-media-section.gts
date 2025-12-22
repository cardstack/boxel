import {
  // Component,
  FieldDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import ColorField from 'https://cardstack.com/base/color';

import { SectionCard } from './section-card';

class FlowStepField extends FieldDef {
  static displayName = 'Flow Step';

  @field stepIcon = contains(StringField);
  @field stepLabel = contains(StringField);
  @field stepDetail = contains(StringField);
  @field isAiAction = contains(BooleanField);
}

class FlowTabField extends FieldDef {
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
}

export class SoftwareMediaSection extends SectionCard {
  static displayName = 'Software as Media';

  @field headline = contains(StringField);
  @field subheadline = contains(StringField);
  @field tabs = containsMany(FlowTabField);

  /** Template Features:
   * Video player with play button overlay
   * Optional scroll-scrub interaction
   * Progress bar
   * Info overlay at bottom
   */
}
