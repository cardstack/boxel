import 'decorator-transforms/globals';
import './lib/public-path'; // this should be first
import './lib/setup-globals'; // This should be second
import './deprecation-workflow';
import Application from '@ember/application';
import Resolver from 'ember-resolver';
import loadInitializers from 'ember-load-initializers';
import config from './config/environment';
import '@cardstack/boxel-ui/styles/global.css';
import '@cardstack/boxel-ui/styles/fonts.css';
import '@cardstack/boxel-ui/styles/variables.css';

import compatModules from '@embroider/virtual/compat-modules';

export default class App extends Application {
  modulePrefix = config.modulePrefix;
  podModulePrefix = config.podModulePrefix;
  Resolver = Resolver.withModules(compatModules);
}

loadInitializers(App, config.modulePrefix, compatModules);
