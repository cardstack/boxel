import { FieldDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';

export class KanbanBoardPlacement extends FieldDef {
  static displayName = 'Kanban Board Placement';

  @field itemIndex = contains(NumberField);
  @field columnKey = contains(StringField);
  @field sortOrder = contains(NumberField);
}
