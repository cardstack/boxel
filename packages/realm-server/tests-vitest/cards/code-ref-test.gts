import {
  contains,
  field,
  Component,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import CodeRefField from 'https://cardstack.com/base/code-ref';

export class TestCard extends CardDef {
  @field ref = contains(CodeRefField);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.ref />
    </template>
  };
}
