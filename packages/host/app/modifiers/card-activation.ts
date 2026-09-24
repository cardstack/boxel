import { modifier } from 'ember-modifier';

import { captureCardActivation } from '@cardstack/host/lib/card-open-origin';

export default modifier((element: HTMLElement) => {
  let capture = (event: Event) => captureCardActivation(element, event);
  element.addEventListener('click', capture, true);
  return () => element.removeEventListener('click', capture, true);
});
