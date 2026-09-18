// The instant card code measures elapsed time from.
//
// The implementation is in `@cardstack/runtime-common`, because the host app
// measures the same timestamps and needs the same instant; this is the path
// card code imports it by. See that module for what the pin is, what units it
// takes, and why it is read off a global.
export { now, nowDate } from '@cardstack/runtime-common';
