export type Format =
  | 'isolated'
  | 'embedded'
  | 'fitted'
  | 'edit'
  | 'atom'
  | 'head';

export function isValidFormat(
  format: string,
  formatArr = formats,
): format is Format {
  return formatArr.includes(format as Format);
}

export const formats: Format[] = [
  'isolated',
  'embedded',
  'fitted',
  'atom',
  'edit',
  'head',
];

export const FITTED_FORMATS = [
  {
    name: 'Badges',
    specs: [
      {
        id: 'small-badge',
        title: 'Small Badge',
        width: 150,
        height: 40,
      },
      {
        id: 'medium-badge',
        title: 'Medium Badge',
        width: 150,
        height: 65,
      },
      {
        id: 'large-badge',
        title: 'Large Badge',
        width: 150,
        height: 105,
      },
    ],
  },
  {
    name: 'Strips',
    specs: [
      {
        id: 'single-strip',
        title: 'Single Strip',
        width: 250,
        height: 40,
      },
      {
        id: 'double-strip',
        title: 'Double Strip',
        width: 250,
        height: 65,
      },
      {
        id: 'triple-strip',
        title: 'Triple Strip',
        width: 250,
        height: 105,
      },
      {
        id: 'double-wide-strip',
        title: 'Double Wide Strip',
        width: 400,
        height: 65,
      },
      {
        id: 'triple-wide-strip',
        title: 'Triple Wide Strip',
        width: 400,
        height: 105,
      },
    ],
  },
  {
    name: 'Tiles',
    specs: [
      {
        id: 'small-tile',
        title: 'Small Tile',
        width: 150,
        height: 170,
      },
      {
        id: 'regular-tile',
        title: 'Regular Tile',
        width: 250,
        height: 170,
      },
      {
        id: 'cardsgrid-tile',
        title: 'CardsGrid Tile',
        width: 170,
        height: 250,
      },
      {
        id: 'tall-tile',
        title: 'Tall Tile',
        width: 150,
        height: 275,
      },
      {
        id: 'large-tile',
        title: 'Large Tile',
        width: 250,
        height: 275,
      },
    ],
  },
  {
    name: 'Cards',
    specs: [
      {
        id: 'compact-card',
        title: 'Compact Card',
        width: 400,
        height: 170,
      },
      {
        id: 'full-card',
        title: 'Full Card',
        width: 400,
        height: 275,
      },
      {
        id: 'expanded-card',
        title: 'Expanded Card',
        width: 400,
        height: 445,
      },
    ],
  },
];
