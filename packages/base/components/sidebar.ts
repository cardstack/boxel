// The host bundles this module (see BUNDLED_BASE_MODULES), and the sidebar
// with it, so a base card that imports the sidebar from here loads it without
// a fetch from the pretui realm. A stack that serves only the base realm then
// still renders that card.
export {
  Sidebar,
  SidebarGroup,
  SidebarItem,
  SidebarTrigger,
} from '@cardstack/pretui/components/sidebar';
