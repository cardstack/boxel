import EmberRouter from '@embroider/router';
import config from 'test-app/config/environment';

export default class Router extends EmberRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

Router.map(function () {
  this.route('feature-reel', { path: '/_feature-reel' });
  this.route('mockup-glb', { path: '/_mockup-glb' });
  // Own URLs, declared before /:demo_id so Ember does not eat them as ids.
  this.route('crossing-stress');
  // A spike, not a demo: no catalog entry, no gallery card. See sylva-stage.
  this.route('sylva', { path: '/_sylva' });
  this.route('demo', { path: '/:demo_id' });
});
