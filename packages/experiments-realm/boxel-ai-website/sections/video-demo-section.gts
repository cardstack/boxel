import {
  // Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import URLField from 'https://cardstack.com/base/url';
import enumField from 'https://cardstack.com/base/enum';

import { SectionCard } from './section-card';

export class VideoDemoSection extends SectionCard {
  static displayName = 'Three Modes';

  @field title = contains(StringField);
  @field description = contains(StringField);
  @field badge = contains(enumField(StringField, { options: ['video', 'demo', 'tutorial'] })),
  @field videoUrl = contains(URLField);
  @field posterUrl = contains(URLField);
  @field duration = contains(StringField);

  /** Template Features:
   * Tab navigation between flows
   * Two-column layout: pipeline diagram + step cards
   * AI action nodes inline in pipeline
   * Animated tab transitions
   */
}
