import { BaseDef } from './card-api/-base-def';
import { DefaultAtomViewTemplate } from './card-api/-components/default-atom';
import { FieldDefEditTemplate } from './card-api/-components/field-def-edit';
import { MissingEmbeddedTemplate } from './card-api/-components/missing-embedded';
import { type BaseDefComponent } from './card-api/-components/utils';

export default class FieldDef extends BaseDef {
  // this changes the shape of the class type FieldDef so that a CardDef
  // class type cannot masquarade as a FieldDef class type
  static isFieldDef = true;
  static displayName = 'Field';

  static embedded: BaseDefComponent = MissingEmbeddedTemplate;
  static edit: BaseDefComponent = FieldDefEditTemplate;
  static atom: BaseDefComponent = DefaultAtomViewTemplate;
}

export type FieldDefConstructor = typeof FieldDef;
