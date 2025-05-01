import 'ember-source/types';
import 'ember-source/types/preview';
import * as ContentTagModule from 'content-tag';

declare global {
  interface Window {
    ContentTagGlobal: typeof ContentTagModule;
  }

  var ContentTagGlobal: typeof ContentTagModule;
}
