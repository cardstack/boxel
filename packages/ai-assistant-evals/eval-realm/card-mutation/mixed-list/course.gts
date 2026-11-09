import {
  CardDef,
  FieldDef,
  contains,
  containsMany,
  field,
} from '@cardstack/base/card-api';
import MarkdownField from '@cardstack/base/markdown';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';
import TextAreaField from '@cardstack/base/text-area';
import UrlField from '@cardstack/base/url';

export class LessonBlock extends FieldDef {
  static displayName = 'Lesson Block';
  @field title = contains(StringField);
}

export class VideoBlock extends LessonBlock {
  static displayName = 'Video Block';
  @field videoUrl = contains(UrlField);
  @field minutes = contains(NumberField);
}

export class ReadingBlock extends LessonBlock {
  static displayName = 'Reading Block';
  @field body = contains(MarkdownField);
}

export class QuizBlock extends LessonBlock {
  static displayName = 'Quiz Block';
  @field question = contains(StringField);
  @field answer = contains(TextAreaField);
}

export class Course extends CardDef {
  static displayName = 'Course';
  @field title = contains(StringField);
  @field level = contains(StringField);
  // Each item is one of the LessonBlock subclasses above.
  @field blocks = containsMany(LessonBlock);
  @field blockCount = contains(NumberField, {
    computeVia: function (this: Course) {
      return this.blocks?.length ?? 0;
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Course) {
      return this.title ?? 'Untitled course';
    },
  });
}
