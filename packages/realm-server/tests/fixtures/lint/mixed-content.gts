// Test fixture for mixed JavaScript and template content
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
export class MyCard extends CardDef {
  @field name = contains(StringField);
  @field email = contains(EmailField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div>
        <h1>{{@model.name}}</h1>
        <p>{{@model.email}}</p>
      </div>
    </template>
  };
}
