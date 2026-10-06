// An alias module for the capture tool. Realm content imports the tool from
// `@cardstack/boxel-host/tools/capture-card` (and the `commands/` spelling),
// so this module resolves that specifier, at type-check time as well as at
// runtime, to the tool in `./capture`.
export { default, CaptureCardTool, CaptureCardCommand } from './capture';
