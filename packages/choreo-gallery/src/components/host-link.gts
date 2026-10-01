import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { href, routeId, router } from 'choreo-gallery/lib/host-navigation';
export class LinkTo extends Component<{
  Args: { model?: string; models?: string[]; route: string };
  Blocks: { default: [] };
  Element: HTMLAnchorElement;
}> {
  get href() {
    return href(this.args.route, this.args.models, this.args.model);
  }
  follow = (event: MouseEvent) => {
    if (
      event.button ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    const id = routeId(this.args.route, this.args.models, this.args.model);
    router.transitionTo(id === null ? 'index' : 'demo', id ?? undefined);
  };
  <template>
    <a href={{this.href}} ...attributes {{on 'click' this.follow}}>{{yield}}</a>
  </template>
}
