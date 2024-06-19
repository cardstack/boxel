import { CardDef, Component, field, contains } from './card-api';
import TextAreaField from './text-area';
export class SkillCard extends CardDef {
  static displayName = 'Skill Card';
  @field instructions = contains(TextAreaField);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.title />
    </template>
  };
}
