import { CardDef, Component, field, contains, linksToMany } from './card-api';
import TextAreaField from './text-area';
import CodeRefField from './code-ref';
import StringField from './string';
import BooleanField from './boolean';
import { SkillCard } from './skill-card';

export class LLMCommandCard extends CardDef {
  static displayName = 'LLM Command';
  @field appliesTo = contains(CodeRefField);
  @field commandTitle = contains(StringField);
  @field message = contains(TextAreaField);
  @field includeOpenCard = contains(BooleanField);
  @field attachedSkills = linksToMany(SkillCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.commandTitle /> sends <@fields.message />
    </template>
  };
}
