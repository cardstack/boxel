import EmberRouter from '@ember/routing/router';
import config from 'demo-app/config/environment';

export default class Router extends EmberRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

Router.map(function () {
  this.route('ea-demos');
  this.route('list-detail');
  this.route('interruption');
  this.route('boxel');
  this.route('routes', function () {
    this.route('other');
  });
  this.route('motion-study', function () {
    this.route('details', { path: '/:id' });
  });
  this.route('accordion');
  this.route('nested-contexts');
});
