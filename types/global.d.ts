/* eslint-disable prefer-let/prefer-let */
// Types for compiled templates
declare module 'animations/templates/*' {
  import { TemplateFactory } from 'htmlbars-inline-precompile';
  const tmpl: TemplateFactory;
  export default tmpl;
}
