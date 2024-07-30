import MarkdownField from './markdown';
import { CardDef, Component, field, contains } from './card-api';

export class SkillCard extends CardDef {
  static displayName = 'Skill';
  @field instructions = contains(MarkdownField);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.title />
    </template>
  };
}
