/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable ember/routes-segments-snake-case */
import EmberRouter from '@ember/routing/router';
import config from './config/environment';

class Router extends EmberRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

Router.map(function () {});

export default Router;
