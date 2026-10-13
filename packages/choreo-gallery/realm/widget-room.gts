import {
  CardDef,
  Component,
  field,
  getRelationshipMembershipState,
  linksTo,
} from '@cardstack/base/card-api';

import { ChoreoGallery } from './gallery';
import { roomDemos, WidgetRoom } from './shell/widget-room';

class Isolated extends Component<typeof ChoreoWidgetRoom> {
  get gallery() {
    return this.args.model.gallery as ChoreoGallery | undefined;
  }

  /**
   * The demos to hang, keyed by which they are. Linked demos load lazily, so
   * the room waits until every link has settled and mounts once for the set.
   * The room lays out its walls once, so a later change to the gallery's
   * links is a new room.
   */
  get hanging() {
    const gallery = this.gallery;
    if (!gallery) {
      return [];
    }
    // Reading the demos starts the loads of any links not yet loading.
    const linked = gallery.demos ?? [];
    const { isLoading, membership } = getRelationshipMembershipState(
      gallery,
      'demos',
    );
    if (isLoading || membership?.some((slot) => slot.kind === 'not-loaded')) {
      return [];
    }
    const demos = roomDemos(linked.filter(Boolean));
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
