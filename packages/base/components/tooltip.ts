// The host bundles this module (see BUNDLED_BASE_MODULES), and the tooltip
// with it, so a base card that imports the tooltip from here loads it without
// a fetch from the pretui realm. A stack that serves only the base realm then
// still renders that card.
export { Tooltip } from '@cardstack/pretui/components/tooltip';
