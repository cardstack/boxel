import {
  FieldDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import ColorField from 'https://cardstack.com/base/color';

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
}
