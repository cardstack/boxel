// Pretui — shared by the confirmation and preview layer: AlertDialog, Popconfirm,
// HoverCard.
//
// All three are compositions, not new overlays. `overlay.gts` already owns the
// two hard parts — the native `<dialog>` top layer (focus trap, Escape,
// ::backdrop, stacking) and `anchorTo`, the measuring flip/shift primitive
// that replaced floating-ui. Nothing here re-implements either; what it adds
// is the *contract* each pattern needs on top.
//
// ── The overlay contract, applied verbatim ───────────────────────────────
//
//   @open?  @onOpenChange?  @defaultOpen?   @placement?   @modal?
//   <:trigger>  <:header>  <:default>  <:footer>
//
// The rule the gap doc is emphatic about, and which `Dialog` itself still
// breaks: **`@onClose` is never the only knob.** A parent that can be told the
// thing closed but cannot open it has not been given control of it. Every
// component here takes the controlled/uncontrolled triple, keeps internal
// state only while `@open` is `undefined`, and fires `@onOpenChange` on every
// transition either way.
//
// React argument aliases are accepted where the corpus is consistent about
// them: Ant's `okText` / `cancelText` / `showCancel`, Radix's `openDelay` /
// `closeDelay`, `side`+`align` collapsed into `@placement`.

/** Anything inside a trigger block that can hold focus. Used to find the one
 * control the caller actually rendered, so the component can put ARIA on it
 * and hand focus back to it — the trigger is a block, so the component can
 * never capture the button directly. */
const TRIGGER_CONTROL =
  'button, [role="button"], a[href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function controlIn(el: HTMLElement): HTMLElement {
  return (el.querySelector(TRIGGER_CONTROL) as HTMLElement | null) ?? el;
}
