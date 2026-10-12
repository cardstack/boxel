import { CardDef, Component, field, linksTo } from '@cardstack/base/card-api';

import { ChoreoGallery } from './gallery';
import { roomDemos, WidgetRoom } from './shell/widget-room';

class Isolated extends Component<typeof ChoreoWidgetRoom> {
  get gallery() {
    return this.args.model.gallery as ChoreoGallery | undefined;
  }

  get demos() {
    return roomDemos((this.gallery?.demos ?? []).filter(Boolean));
  }

  get homeHref() {
    return this.gallery?.id ?? '';
  }

  <template>
    {{#if this.demos.length}}
      <WidgetRoom @demos={{this.demos}} @homeHref={{this.homeHref}} />
    {{/if}}
  </template>
}

/**
 * The gallery's demos hung in a 3D room: six bays a visitor walks through,
 * each demo live on its wall, with a narrated quick tour and a full audio
 * tour. It hangs the demos its gallery links.
 */
export class ChoreoWidgetRoom extends CardDef {
  static displayName = 'Choreo Widget Room';
  static prefersWideFormat = true;

  @field gallery = linksTo(() => ChoreoGallery);

  static isolated = Isolated;
}
