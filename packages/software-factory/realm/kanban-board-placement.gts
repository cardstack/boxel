import { FieldDef, field, contains } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';

export class KanbanBoardPlacement extends FieldDef {
  static displayName = 'Kanban Board Placement';

  @field itemId = contains(StringField);
  @field columnKey = contains(StringField);
  @field sortOrder = contains(NumberField);
}
