import Application from '@ember/application';
import Resolver from 'ember-resolver';
import loadInitializers from 'ember-load-initializers';
import config from './config/environment';
import '@cardstack/boxel-ui/styles/global.css';
import '@cardstack/boxel-ui/styles/fonts.css';
import '@cardstack/boxel-ui/styles/variables.css';
import '@cardstack/boxel-ui/styles/theme.css';
// Imports into the `vendor` layer; the inline <style> in index.html
// declares the layer order, so import position here doesn't matter.
import './vendor.css';
import './deprecation-workflow';

import setupInspector from '@embroider/legacy-inspector-support/ember-source-4.12';
import compatModules from '@embroider/virtual/compat-modules';

export default class App extends Application {
  modulePrefix = config.modulePrefix;
  podModulePrefix = config.podModulePrefix;
  Resolver = Resolver.withModules(compatModules);
  inspector = setupInspector(this);
}

loadInitializers(App, config.modulePrefix, compatModules);
