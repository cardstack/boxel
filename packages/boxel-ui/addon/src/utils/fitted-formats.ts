export type FittedFormatId =
  | 'cardsgrid-tile'
  | 'compact-card'
  | 'double-strip'
  | 'double-wide-strip'
  | 'expanded-card'
  | 'full-card'
  | 'large-badge'
  | 'large-tile'
  | 'medium-badge'
  | 'regular-tile'
  | 'single-strip'
  | 'small-badge'
  | 'small-tile'
  | 'tall-tile'
  | 'triple-strip'
  | 'triple-wide-strip';

export type FittedFormatSpec = {
  id: FittedFormatId;
  title: string;
  width: number;
  height: number;
};

type FittedFormatGallery = ReadonlyArray<{
  name: string;
  specs: FittedFormatSpec[];
}>;

export const FITTED_FORMATS: FittedFormatGallery = [
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

export const FITTED_FORMAT_SIZES = FITTED_FORMATS.flatMap(
  (group) => group.specs,
);

export const fittedFormatIds = FITTED_FORMAT_SIZES.flatMap(
  (formatSpec) => formatSpec.id,
);

export const fittedFormatById: ReadonlyMap<FittedFormatId, FittedFormatSpec> =
  new Map<FittedFormatId, FittedFormatSpec>(
    FITTED_FORMAT_SIZES.map((format) => [format.id, format]),
  );
