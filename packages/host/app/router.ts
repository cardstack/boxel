import EmberRouter from '@ember/routing/router';
import config from '@cardstack/host/config/environment';
const { ownRealmURL, hostsOwnAssets } = config;

export default class Router extends EmberRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

let path = new URL(ownRealmURL).pathname.replace(/\/$/, '');

Router.map(function () {
  this.route('hello');
  this.route('freestyle', { path: '/_freestyle' });
  this.route('indexer', { path: '/indexer/:id' });
  this.route('acceptance-test-setup');
  // this.route('card', { path: '/*path' });

  if (!path || hostsOwnAssets) {
    this.route('chat', function () {
      this.route('register');
      this.route('room', { path: `/room/:id` });
    });
    this.route('index-card', { path: '/' });
    this.route('code');
  } else {
    this.route('chat', { path: `${path}/chat` }, function () {
      this.route('register');
      this.route('room', { path: `/room/:id` });
    });

    this.route('code', { path: `${path}/code` });
  }
});
