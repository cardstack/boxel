import EmberRouter from '@ember/routing/router';
import config from '@cardstack/host/config/environment';

export default class Router extends EmberRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

Router.map(function () {
  this.route('host-freestyle', { path: '/_freestyle' });
  this.route('indexer', { path: '/indexer/:id' });
  this.route('render', { path: '/render/:id/:nonce/:options' }, function () {
    this.route('html', { path: '/html/:format/:ancestor_level' });
    this.route('icon');
    this.route('meta');
    this.route('error');
  });
  this.route('connect', { path: '/connect/:origin' });

  this.route('index-root', { path: '/' });
  this.route('index', { path: '/*path' });

  // this route is empty but lets the application.hbs render, so that the CardPrerender
  // component exists to support the indexer
  this.route('acceptance-test-setup');
});
