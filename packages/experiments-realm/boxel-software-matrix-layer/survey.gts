import {
  CardDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import NumberField from 'https://cardstack.com/base/number';
import ClipboardListIcon from '@cardstack/boxel-icons/clipboard-list';
import { SurveyQuestion } from './survey-question';
import { SurveyIsolated } from './components/survey/isolated-template';
import { SurveyFitted } from './components/survey/fitted-template';

export class Survey extends CardDef {
  static displayName = 'Survey';
  static icon = ClipboardListIcon;
  static prefersWideFormat = true;

  @field title = contains(StringField);
  @field description = contains(MarkdownField);
  @field questions = containsMany(SurveyQuestion);

  @field questionCount = contains(NumberField, {
    computeVia: function (this: Survey) {
      return this.questions?.length ?? 0;
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Survey) {
      return this.cardInfo?.name ?? this.title ?? 'Survey';
    },
  });
}

Survey.isolated = SurveyIsolated;
Survey.fitted = SurveyFitted;
