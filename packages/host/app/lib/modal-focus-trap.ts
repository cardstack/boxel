interface ModalFocusArgs {
  onClose: () => void;
  returnFocusTarget?: () => HTMLElement | undefined;
}

// Options for the `focusTrap` modifier on a modal whose element has the id
// `dialogId`. Focus opens on the element marked `data-modal-initial-focus`,
// or on the modal itself when none is, stays in the modal, and on close goes
// to `returnFocusTarget` or back to where it was. Escape closes the modal.
export function modalFocusTrapOptions(dialogId: string, args: ModalFocusArgs) {
  return {
    initialFocus: () =>
      document.querySelector<HTMLElement>(
        `#${dialogId} [data-modal-initial-focus]`,
      ) ?? `#${dialogId}`,
    fallbackFocus: `#${dialogId}`,
    allowOutsideClick: true,
    escapeDeactivates: () => {
      args.onClose();
      return false;
    },
    setReturnFocus: (previous: HTMLElement | SVGElement) =>
      args.returnFocusTarget?.() ?? previous,
  };
}

// The element when it's still on the page, for a `returnFocusTarget` whose
// opener may have been replaced or removed while the modal was open.
export function ifConnected(
  element: HTMLElement | undefined,
): HTMLElement | undefined {
  return element?.isConnected ? element : undefined;
}
