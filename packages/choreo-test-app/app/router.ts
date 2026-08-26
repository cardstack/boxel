import EmberRouter from '@embroider/router';
import config from 'test-app/config/environment';

export default class Router extends EmberRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

Router.map(function () {
  this.route('feature-reel', { path: '/_feature-reel' });
  this.route('crossing-reel', { path: '/_crossing-reel' });
  this.route('demo', { path: '/:demo_id' });
});
