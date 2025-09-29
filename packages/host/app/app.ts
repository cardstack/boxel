import 'decorator-transforms/globals';
import './lib/public-path'; // this should be first
import './lib/setup-globals'; // This should be second
import './deprecation-workflow';
import Application from '@ember/application';
import Resolver from 'ember-resolver';
import loadInitializers from 'ember-load-initializers';
import config from '@cardstack/host/config/environment';
import './lib/glint-embroider-workaround';
import '@cardstack/boxel-ui/styles/global.css';
import '@cardstack/boxel-ui/styles/fonts.css';
import '@cardstack/boxel-ui/styles/variables.css';
import 'ember-power-select/styles';
import 'ember-power-calendar/styles';

// FIXME: remove, just to trigger host tests

export default class App extends Application {
  modulePrefix = config.modulePrefix;
  podModulePrefix = config.podModulePrefix;
  Resolver = Resolver;
}

loadInitializers(App, config.modulePrefix);
