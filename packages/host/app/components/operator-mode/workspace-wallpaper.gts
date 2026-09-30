import Component from '@glimmer/component';

import { motion } from 'glimmer-motion';

import { cssVar } from '@cardstack/boxel-ui/helpers';

interface Signature {
  Args: { backgroundURL?: string };
}

// The stationary world behind the portal. The aperture moves, not the image.
export default class WorkspaceWallpaper extends Component<Signature> {
  private get image() {
    return this.args.backgroundURL
      ? `url(${JSON.stringify(this.args.backgroundURL)})`
      : 'none';
  }
  <template>
    <div
      class='workspace-wallpaper'
      aria-hidden='true'
      style={{cssVar wallpaper-image=this.image}}
      {{motion role='workspace-wallpaper'}}
    ></div>
    <style scoped>
      .workspace-wallpaper {
        position: absolute;
        inset: 0;
        z-index: 0;
        pointer-events: none;
        background-image: var(--wallpaper-image);
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
      }
    </style>
  </template>
}
