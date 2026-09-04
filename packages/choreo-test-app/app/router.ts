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
  /* THE FILMS OWN THEIR OWN NAMES. Each was two URLs for a while — a
     demo page that framed the picture in an iframe and wrote the wall
     plate under it, and an underscored theater route that ran the
     picture full width and wrote the SAME wall plate under it. They
     were the same page twice. So the film takes the plain name, carries
     its dive beneath itself, and there is one address to send anyone.
     Declared before /:demo_id so the catalog cannot eat them. */
  /* the transition reel: the film construct pointed at plates rather than
     a building, to see whether the seam system holds up outside the two
     films it was lifted from */
  this.route('seams', { path: '/_seams' });
  this.route('towers');
  this.route('sagrada');
  this.route('demo', { path: '/:demo_id' });
});
