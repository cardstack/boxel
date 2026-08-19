import type ApplicationInstance from '@ember/application/instance';
import { registerDestructor } from '@ember/destroyable';

import { ThemeStyleDeduper } from '../lib/theme-style-deduper';

// Cards sharing a theme each carry a byte-identical copy of the theme
// stylesheet (self-contained prerendered fragments require this); only one
// copy per theme needs to be active in the live DOM.
export function initialize(appInstance: ApplicationInstance): void {
  if (typeof document === 'undefined') {
    return;
  }
  let deduper = new ThemeStyleDeduper();
  deduper.start();
  registerDestructor(appInstance, () => deduper.stop());
}

export default {
  initialize,
};
