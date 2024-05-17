import { BaseDef } from './-base-def';
import { DefaultAtomViewTemplate } from './-components/default-atom';
import { FieldDefEditTemplate } from './-components/field-def-edit';
import { MissingEmbeddedTemplate } from './-components/missing-embedded';
import { type BaseDefComponent } from './-components/utils';

export class FieldDef extends BaseDef {
  // this changes the shape of the class type FieldDef so that a CardDef
  // class type cannot masquarade as a FieldDef class type
  static isFieldDef = true;
  static displayName = 'Field';

  static embedded: BaseDefComponent = MissingEmbeddedTemplate;
  static edit: BaseDefComponent = FieldDefEditTemplate;
  static atom: BaseDefComponent = DefaultAtomViewTemplate;
}

export type FieldDefConstructor = typeof FieldDef;
