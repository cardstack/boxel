import { CardDef, Component, field, linksTo } from '@cardstack/base/card-api';

import { ChoreoGallery } from './gallery';
import { roomDemos, WidgetRoom } from './shell/widget-room';

class Isolated extends Component<typeof ChoreoWidgetRoom> {
  get gallery() {
    return this.args.model.gallery as ChoreoGallery | undefined;
  }

  /**
   * The demos to hang, keyed by which they are. Linked demos load lazily, and
   * the room lays out its walls once, so a new set of demos is a new room.
   */
  get hanging() {
    const demos = roomDemos((this.gallery?.demos ?? []).filter(Boolean));
    return demos.length
      ? [{ demos, key: demos.map((demo) => demo.id).join(' ') }]
      : [];
  }

  get homeHref() {
    return this.gallery?.id ?? '';
  }

  <template>
    {{#each this.hanging key='key' as |room|}}
      <WidgetRoom @demos={{room.demos}} @homeHref={{this.homeHref}} />
    {{/each}}
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
