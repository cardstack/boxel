import Component from '@glimmer/component';

import IconCircle from '../../icons/icon-circle.gts';

interface Signature {
  Element: SVGElement;
}

export default class CircleSpinner extends Component<Signature> {
  <template>
    <IconCircle class='circle-spinner' ...attributes />
    <style>
      .circle-spinner {
        animation: rotate 1.5s ease-in-out infinite;
      }
      .circle-spinner > :deep(circle) {
        animation: dash 1.5s ease-in-out infinite;
      }
      @keyframes rotate {
        100% {
          transform: rotate(360deg);
        }
      }

      @keyframes dash {
        0% {
          stroke-dasharray: 1, 150;
          stroke-dashoffset: 0;
        }
        50% {
          stroke-dasharray: 90, 150;
          stroke-dashoffset: -35;
        }
        100% {
          stroke-dasharray: 90, 150;
          stroke-dashoffset: -124;
        }
      }
    </style>
  </template>
}
