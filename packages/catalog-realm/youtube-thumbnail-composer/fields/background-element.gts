import { FieldDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import ColorField from 'https://cardstack.com/base/color';
import UrlField from 'https://cardstack.com/base/url';
import NumberField from 'https://cardstack.com/base/number';
import { ImageField } from '../../image-field';

export class BackgroundElement extends FieldDef {
  static displayName = 'Background';

  @field type = contains(StringField); // 'solid', 'gradient', 'image'
  @field primaryColor = contains(ColorField);
  @field secondaryColor = contains(ColorField);
  @field gradientDirection = contains(StringField);
  @field backgroundImage = contains(ImageField);
  @field imageUrl = contains(UrlField);
  @field opacity = contains(NumberField);
}
