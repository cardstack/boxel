import { modifier } from 'ember-modifier';

/**
 * The keyboard for a segmented choice drawn as `role='radiogroup'`: the group
 * is one Tab stop, on its checked radio, and the arrow keys, Home and End move
 * between the radios. Moving is choosing, as the ARIA radio group pattern has
 * it, and the radios are a ring, so the last arrows round to the first.
 *
 * The component renders each radio's `aria-checked` and gives the checked one
 * `tabindex='0'` and the rest `-1`; this modifier, on the group, reads the
 * radios from the DOM, hands the chosen index to `pick`, and moves focus.
 */
export const radioKeys = modifier(
  (group: HTMLElement, [pick]: [(index: number) => void]) => {
    let keydown = (event: KeyboardEvent) => {
      if (event.altKey || event.metaKey || event.ctrlKey) {
        return;
      }
      let radios = [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
      let at = radios.findIndex((radio) =>
        radio.contains(event.target as Node),
      );
      if (at < 0) {
        return;
      }
      let step: number | undefined;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        step = at + 1;
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        step = at - 1;
      } else if (event.key === 'Home') {
        step = 0;
      } else if (event.key === 'End') {
        step = radios.length - 1;
      }
      if (step === undefined) {
        return;
      }
      event.preventDefault();
      let next = (step + radios.length) % radios.length;
      pick(next);
      radios[next]?.focus();
    };
    group.addEventListener('keydown', keydown);
    return () => group.removeEventListener('keydown', keydown);
  },
);

/** how long a passed focus waits for its stand-in to render */
const PASS_MS = 1000;

/** the stand-in a control named as it removed itself, until it renders */
let pending: { at: number; name: string } | null = null;

/**
 * A control that removes itself when activated names the control that takes
 * its place, so focus lands there instead of falling to the document. Call it
 * from the activation, before the change that unmounts the control.
 */
export function passFocus(to: string): void {
  pending = { at: performance.now(), name: to };
}

/**
 * The receiving end of `passFocus`: the element takes focus as it renders if
 * focus was passed to its name in the last moment. Focus already inside it,
 * or on some other control the activation moved it to, is left where it is.
 */
export const takesFocus = modifier((element: HTMLElement, [name]: [string]) => {
  let passed = pending;
  if (passed?.name !== name) {
    return;
  }
  pending = null;
  if (performance.now() - passed.at > PASS_MS) {
    return;
  }
  let active = document.activeElement;
  if (!active || active === document.body || !active.isConnected) {
    element.focus();
  }
});
