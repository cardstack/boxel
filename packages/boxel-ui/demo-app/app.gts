import '../src/styles/global.css';
import '../src/styles/fonts.css';
import '../src/styles/variables.css';

import EmberRouter from '@ember/routing/router';
import EmberFreestyleService from 'ember-freestyle/services/ember-freestyle';
import PageTitleService from 'ember-page-title/services/page-title';
import PowerCalendarService from 'ember-power-calendar/services/power-calendar';
import EmberApp from 'ember-strict-application-resolver';

class Router extends EmberRouter {
  location = 'history';
  rootURL = '/';
}

export class App extends EmberApp {
  /**
   * Any services or anything from the addon that needs to be in the app-tree registry
   * will need to be manually specified here.
   *
   * Techniques to avoid needing this:
   * - private services
   * - require the consuming app import and configure themselves
   *   (which is what we're emulating here)
   */
  modules = {
    './router': Router,
    './services/page-title': PageTitleService,
    './services/ember-freestyle': EmberFreestyleService,
    './services/power-calendar': PowerCalendarService,
    ...import.meta.glob(
      ['./controllers/**/*', './routes/**/*', './templates/**/*'],
      {
        eager: true,
      },
    ),
  };
}

Router.map(function () {});
