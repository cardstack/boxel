import EmberRouter from '@ember/routing/router';
import config from '@cardstack/host/config/environment';
const { ownRealmURL, hostsOwnAssets } = config;

export default class Router extends EmberRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

let path = new URL(ownRealmURL).pathname.replace(/\/$/, '');

Router.map(function () {
  this.route('freestyle', { path: '/_freestyle' });
  this.route('indexer', { path: '/indexer/:id' });
  this.route('acceptance-test-setup');
  this.route('chat', { path: `${path}/chat` }, function () {
    this.route('register');
    this.route('room', { path: `/room/:id` });
  });
  if (!path || hostsOwnAssets) {
    this.route('index-card', { path: '/' });
    this.route('code');
  } else {
    this.route('card', { path });
    this.route('code', { path: `${path}/code` });
  }
  this.route('card', { path: '/*path' });
});
