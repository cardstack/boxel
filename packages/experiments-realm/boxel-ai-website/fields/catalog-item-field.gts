import {
  CardDef,
  FieldDef,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import ColorField from 'https://cardstack.com/base/color';
import enumField from 'https://cardstack.com/base/enum';

export class CatalogItemField extends FieldDef {
  static displayName = 'Catalog Item';

  @field itemIcon = contains(StringField);
  @field itemTitle = contains(StringField);
  @field itemDescription = contains(StringField);
  @field itemPrice = contains(StringField);
  @field linkedCard = linksTo(() => CardDef);
  @field badge = contains(
    enumField(StringField, { options: ['app', 'skill', 'theme'] }),
  );
  @field isHighlighted = contains(BooleanField);
  @field accentColor = contains(ColorField);
}

export class CategoryPillField extends FieldDef {
  static displayName = 'Category Pill';

  @field categoryIcon = contains(StringField);
  @field categoryLabel = contains(StringField);
}
