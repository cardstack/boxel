import ApplicationInstance from '@ember/application/instance';
import type { BootOptions } from '@ember/engine/instance';

import Ember from 'ember';

declare const FastBoot: unknown;

let hasPatchedBootSync = false;

export function initialize(): void {
  let log = (message: string) => console.log(`[rehydrate:init] ${message}`);

  // let fastbootBodyStart = document?.getElementById('boxel-isolated-start');

  // if (fastbootBodyStart) {
  //   log('Found body start, removing');
  //   fastbootBodyStart.parentNode?.removeChild(fastbootBodyStart);
  // }

  // let fastbootBodyEnd = document?.getElementById('boxel-isolated-end');

  // if (fastbootBodyEnd) {
  //   log('Found body end, removing');
  //   fastbootBodyEnd.parentNode?.removeChild(fastbootBodyEnd);
  // }

  return;

  log('start');

  if (hasPatchedBootSync) {
    log('already patched');
    return;
  }

  if (typeof FastBoot !== 'undefined') {
    log('FastBoot detected, skipping');
    return;
  }

  if (typeof document === 'undefined') {
    log('no document, skipping');
    return;
  }

  let current = document.getElementById('boxel-isolated-start');

  if (!current) {
    log('boxel-isolated-start not found');
    return;
  }

  let isSerializationFirstNode = Ember.ViewUtils?.isSerializationFirstNode;

  if (typeof isSerializationFirstNode !== 'function') {
    console.error(
      "Experimental render mode rehydrate isn't working because it couldn't find Ember.ViewUtils.isSerializationFirstNode.",
    );
    log('isSerializationFirstNode missing');
    return;
  }

  // debugger;

  // let nextSibling = current.nextSibling;

  // if (!nextSibling || !isSerializationFirstNode(nextSibling)) {
  //   log('serialization marker not found');
  //   return;
  // }

  log('patching ApplicationInstance._bootSync');
  hasPatchedBootSync = true;
  let originalBootSync = ApplicationInstance.prototype._bootSync;

  ApplicationInstance.reopen({
    _bootSync(this: ApplicationInstance, options?: BootOptions) {
      console.log('bootSync', this, options);
      if (options === undefined) {
        options = {
          _renderMode: 'rehydrate',
        };
      }

      return originalBootSync.call(this, options);
    },
  });

  log('removing fastboot markers');
  current.parentNode?.removeChild(current);
  let end = document.getElementById('boxel-isolated-end');

  if (end?.parentNode) {
    end.parentNode.removeChild(end);
  }

  log('done');
}

export default {
  initialize,
};
