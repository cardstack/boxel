// A public base path: no base card uses the handle, but realm cards may import
// it from here. The host bundles this module (see BUNDLED_BASE_MODULES), and
// the handle with it, so such a card loads it without a fetch from the pretui
// realm.
export { ResizeHandle } from '@cardstack/pretui/components/resize-handle';
