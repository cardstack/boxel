import EmberRouter from '@embroider/router';
import config from 'test-app/config/environment';

export default class Router extends EmberRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

Router.map(function () {
  this.route('feature-reel', { path: '/_feature-reel' });
  this.route('mockup-spike', { path: '/_mockup-spike' });
  // Own URLs, declared before /:demo_id so Ember does not eat them as ids.
  this.route('crossing-stress');
  this.route('demo', { path: '/:demo_id' });
});
