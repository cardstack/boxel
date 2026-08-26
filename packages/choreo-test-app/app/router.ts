import EmberRouter from '@embroider/router';
import config from 'test-app/config/environment';

export default class Router extends EmberRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

Router.map(function () {
  this.route('feature-reel', { path: '/_feature-reel' });
  // Own URLs, not a capture underscore-route and not a /:demo_id.
  this.route('crossing-reel', { path: '/crossing-reel' });
  this.route('crossing-stress', { path: '/crossing-stress' });
  this.route('demo', { path: '/:demo_id' });
});
