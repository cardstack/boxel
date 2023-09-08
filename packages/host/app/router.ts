import EmberRouter from '@ember/routing/router';
import config from '@cardstack/host/config/environment';
const { ownRealmURL, resolvedOwnRealmURL, hostsOwnAssets } = config;

export default class Router extends EmberRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

// When resolvedOwnRealmURL is available, that is actually the path in the browser.
// It will not be available when running in fastboot.
// When paths of resolvedOwnRealmURL and ownRealmURL are not symmetrical,
// that means that means the resolvedOwnRealmURL should be used instead of ownRealmURL.
let path = new URL(resolvedOwnRealmURL ?? ownRealmURL).pathname.replace(
  /\/$/,
  '',
);

Router.map(function () {
  this.route('freestyle', { path: '/_freestyle' });
  this.route('indexer', { path: '/indexer/:id' });
  this.route('acceptance-test-setup');
  this.route('card', { path: '/*path' });

  if (!path || hostsOwnAssets) {
    this.route('index-card', { path: '/' });
  }
});
