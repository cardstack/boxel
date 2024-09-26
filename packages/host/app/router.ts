import EmberRouter from '@ember/routing/router';
import config from '@cardstack/host/config/environment';
const { hostsOwnAssets } = config;

export default class Router extends EmberRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

Router.map(function () {
  this.route('host-freestyle', { path: '/_freestyle' });
  this.route('indexer', { path: '/indexer/:id' });
  this.route('card', { path: '/*path' });

  // this route is empty but lets the application.hbs render, so that the CardPrerender
  // component exists to support the indexer
  this.route('acceptance-test-setup');

  // if (hostsOwnAssets) {
  //   this.route('index-card', { path: '/' });
  // }
});
