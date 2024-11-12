import Application from '@ember/application';
import Resolver from 'ember-resolver';
import loadInitializers from 'ember-load-initializers';
import config from 'test-app/config/environment';
import '@cardstack/boxel-ui/styles/global.css';
import '@cardstack/boxel-ui/styles/fonts.css';
import '@cardstack/boxel-ui/styles/variables.css';
import 'ember-power-select/styles';
import './deprecation-workflow';
import { registerDateLibrary } from 'ember-power-calendar';
import DateUtils from 'ember-power-calendar-moment';
import 'ember-power-calendar/styles';

registerDateLibrary(DateUtils);

export default class App extends Application {
  modulePrefix = config.modulePrefix;
  podModulePrefix = config.podModulePrefix;
  Resolver = Resolver;
}

loadInitializers(App, config.modulePrefix);
