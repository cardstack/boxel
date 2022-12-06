import EmberRouter from '@ember/routing/router';
import config from '@cardstack/host/config/environment';

export default class Router extends EmberRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

Router.map(function () {
  this.route('index', { path: '/' });
  this.route('render');
});
