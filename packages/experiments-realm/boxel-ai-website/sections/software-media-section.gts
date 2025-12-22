import {
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { FlowTabField } from '../fields/flow-step-field';
import { SectionCard } from './section-card';

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
