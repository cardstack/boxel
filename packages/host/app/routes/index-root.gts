import type RouterService from '@ember/routing/router-service';

import IndexRoute from './index';

export default class IndexRootRoute extends IndexRoute {
  controllerName = 'index';
  templateName = 'index';
}
