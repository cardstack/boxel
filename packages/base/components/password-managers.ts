// The host bundles this module (see BUNDLED_BASE_MODULES), and the modifier
// with it, so a base field that imports the modifier from here loads it
// without a fetch from the pretui realm. A stack that serves only the base
// realm then still renders that field.
export { ignoredByPasswordManagers } from '@cardstack/pretui/password-managers';
