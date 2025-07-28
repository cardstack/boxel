import { FieldDef, containsMany, field } from './card-api';
import { FileDef } from './file-api';

export class SkillConfigField extends FieldDef {
  static displayName = 'Skill Configuration';

  @field enabledSkillCards = containsMany(FileDef);
  @field disabledSkillCards = containsMany(FileDef);
  @field commandDefinitions = containsMany(FileDef);
}
