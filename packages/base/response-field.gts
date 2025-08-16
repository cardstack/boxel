import { primitive, FieldDef } from './card-api';

export default class ResponseField extends FieldDef {
  static displayName = 'Response';
  static [primitive]: Response;
}
