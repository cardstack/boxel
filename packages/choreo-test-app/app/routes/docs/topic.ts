import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import { findGuide } from 'test-app/lib/guides';

export default class DocsTopicRoute extends Route {
  @service declare router: RouterService;
  model(params: { topic_id: string }) {
    if (params.topic_id === 'interactive-spatial') {
      void this.router.replaceWith('docs.topic', 'spatial-start');
    }
    return { guide: findGuide(params.topic_id) };
  }
}
