import 'decorator-transforms/globals';
import './lib/public-path'; // this should be first
import './lib/setup-globals'; // This should be second
import './deprecation-workflow';
import Application from '@ember/application';
import { importSync, isDevelopingApp, macroCondition } from '@embroider/macros';
import Resolver from 'ember-resolver';
import loadInitializers from 'ember-load-initializers';
import config from './config/environment';
import '@cardstack/boxel-ui/styles/global.css';
import '@cardstack/boxel-ui/styles/fonts.css';
import '@cardstack/boxel-ui/styles/variables.css';
import 'katex/dist/katex.min.css';

import compatModules from '@embroider/virtual/compat-modules';

export default class App extends Application {
  modulePrefix = config.modulePrefix;
  podModulePrefix = config.podModulePrefix;
  Resolver = Resolver.withModules(compatModules);

  // Let ember-inspector reach ember-source modules in development. The macro
  // strips this assignment (and the import) from production builds entirely.
  inspector = macroCondition(isDevelopingApp())
    ? (
        importSync('@embroider/legacy-inspector-support/ember-source-4.12') as {
          default: (app: Application) => void;
        }
      ).default(this)
    : undefined;
}

loadInitializers(App, config.modulePrefix, compatModules);
