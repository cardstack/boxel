// Types for compiled templates
declare module 'runtime-spike/templates/*' {
  import { TemplateFactory } from 'htmlbars-inline-precompile';
  const tmpl: TemplateFactory;
  export default tmpl;
}

declare function showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
