import Application from '@ember/application';
import config from 'boxel-motion-test-app/config/environment';
import loadInitializers from 'ember-load-initializers';
import Resolver from 'ember-resolver';
import './deprecation-workflow';

export default class App extends Application {
  modulePrefix = config.modulePrefix;
  podModulePrefix = config.podModulePrefix;
  Resolver = Resolver;
}

loadInitializers(App, config.modulePrefix);
