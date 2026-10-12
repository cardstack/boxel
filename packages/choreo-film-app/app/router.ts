import EmberRouter from '@embroider/router';
import config from 'choreo-film-app/config/environment';

/** one film per document, so there is nothing to route */
export default class Router extends EmberRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

Router.map(function () {});
