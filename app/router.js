import EmberRouter from '@ember/routing/router';
import config from 'animations/config/environment';

export default class Router extends EmberRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

Router.map(function () {
  this.route('ea-demos');
  this.route('list-detail');
  this.route('interruption');
  this.route('boxel');
});
