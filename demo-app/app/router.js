import EmberRouter from '@ember/routing/router';
import config from 'demo-app/config/environment';

export default class Router extends EmberRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

Router.map(function () {
  this.route('basics');
  this.route('interruption');
  this.route('routes', function () {
    this.route('other');
  });
  this.route('motion-study', function () {
    this.route('details', { path: '/:id' });
  });
  this.route('accordion');
  this.route('nested-contexts');
  this.route('context-selection');
  this.route('nested-sprites');
  this.route('removed-sprite-interruption');
  this.route('simple-orchestration');
  this.route('list');
});
