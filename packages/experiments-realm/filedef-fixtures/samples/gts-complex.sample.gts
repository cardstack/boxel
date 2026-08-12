import {
  CardDef,
  FieldDef,
  contains,
  containsMany,
  field,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import FileDef from 'https://cardstack.com/base/file-api';
import StringField from 'https://cardstack.com/base/string';
import TextAreaField from 'https://cardstack.com/base/text-area';

export class ReleaseTargetField extends FieldDef { // First exported module is a reusable schema shape
  static displayName = 'Release Target';
  @field name = contains(StringField);
  @field environment = contains(StringField);
}

export class ReleaseAsset extends CardDef { // Second exported module composes the shared field
  static displayName = 'Release Asset';
  @field title = contains(StringField);
  @field version = contains(StringField);
  @field target = contains(ReleaseTargetField);
  @field artifacts = linksToMany(() => FileDef);
  @field maintainers = containsMany(StringField);
  @field notes = contains(TextAreaField);
}

export function releaseLabel(name: string, version: string): string { // Callable export remains available in detailed metadata
  return `${name} · ${version}`;
}
