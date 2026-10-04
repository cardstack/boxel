// The capture tool's former module name. Realm content imports the tool from
// `@cardstack/boxel-host/tools/capture-card` (and the older `commands/`
// spelling), so this module keeps that specifier resolving — at type-check
// time as well as at runtime — to the tool in `./capture`.
export { default, CaptureCardTool, CaptureCardCommand } from './capture';
