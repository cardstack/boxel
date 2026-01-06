import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import ColorField from 'https://cardstack.com/base/color';
import enumField from 'https://cardstack.com/base/enum';

import { cssVar } from '@cardstack/boxel-ui/helpers';

export class AnimatedGrid extends CardDef {
  static displayName = 'Animated Grid';

  @field gridColumns = contains(NumberField, {
    description: 'Number of columns. Default to 6',
  });
  @field gridRows = contains(NumberField, {
    description: 'Number of rows. Default to 4',
  });
  @field animationSpeed = contains(
    enumField(StringField, { options: ['slow', 'medium', 'fast'] }), // default: medium
  );
  @field cardOpacity = contains(NumberField); // 0.0 to 1.0; default: 0.3
  @field accentColor = contains(ColorField, {
    description: 'Hex color for highlight cards',
  });

  static isolated = class Isolated extends Component<typeof this> {
    get totalCells() {
      return (
        (this.args.model?.gridColumns ?? 6) * (this.args.model?.gridRows ?? 4)
      );
    }

    get cellArray() {
      return Array.from({ length: this.totalCells }, (_, i) => i);
    }

    <template>
      <div
        class='animated-grid'
        style={{cssVar
          grid-columns=@model.gridColumns
          grid-rows=@model.gridRows
          card-opacity=@model.cardOpacity
          accent-color=@model.accentColor
        }}
      >
        {{#each this.cellArray as |index|}}
          <div class='grid-cell' data-index={{index}}></div>
        {{/each}}
      </div>

      <style scoped>
        .animated-grid {
          width: 100%;
          height: 100%;
          display: grid;
          grid-template-columns: repeat(var(--grid-columns, 6), 1fr);
          grid-template-rows: repeat(var(--grid-rows, 4), 1fr);
          gap: 1rem;
          padding: 2rem;
        }

        .grid-cell {
          background: rgba(255, 255, 255, var(--card-opacity, 0.3));
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: var(--radius, 0.5rem);
          transition: all 0.3s ease;
        }

        /* Highlight random cells with accent color */
        .grid-cell:nth-child(3),
        .grid-cell:nth-child(7),
        .grid-cell:nth-child(12),
        .grid-cell:nth-child(19) {
          background: var(--accent-color);
          box-shadow: 0 0 2rem var(--accent-color);
        }

        /* Subtle animation */
        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.6;
          }
        }

        .grid-cell {
          animation: pulse 3s ease-in-out infinite;
          animation-delay: calc(var(--grid-columns) * 0.1s * random());
        }
      </style>
    </template>
  };
}
