// The file the enchant-csv-plant-tracker evaluation starts from: a plant-care
// spreadsheet exported as CSV, saved in the workspace at
// `enchantment/houseplants.csv`. It is a static file, not a card; the
// evaluation asks the assistant to turn it into a tracker app.
//
// Each plant's last watering is a fixed number of days before the day the run
// starts, never a fixed date, so which plants are due stays the same on every
// run: a committed date would leave every plant overdue a few weeks later.
// The success criteria name the plants these offsets make due: a plant is
// due when `wateredDaysAgo` is at least `waterEveryDays`.

import type { EvaluationSeed } from './index.ts';

export const HOUSEPLANTS_PATH = 'enchantment/houseplants.csv';

interface Houseplant {
  name: string;
  species: string;
  room: string;
  light: string;
  waterEveryDays: number;
  wateredDaysAgo: number;
}

const HOUSEPLANTS: Houseplant[] = [
  {
    name: 'Boston Fern',
    species: 'Nephrolepis exaltata',
    room: 'Bathroom',
    light: 'medium indirect',
    waterEveryDays: 3,
    wateredDaysAgo: 4,
  },
  {
    name: 'Snake Plant',
    species: 'Dracaena trifasciata',
    room: 'Bedroom',
    light: 'low',
    waterEveryDays: 14,
    wateredDaysAgo: 14,
  },
  {
    name: 'Monstera',
    species: 'Monstera deliciosa',
    room: 'Living Room',
    light: 'bright indirect',
    waterEveryDays: 7,
    wateredDaysAgo: 3,
  },
  {
    name: 'Fiddle-Leaf Fig',
    species: 'Ficus lyrata',
    room: 'Living Room',
    light: 'bright indirect',
    waterEveryDays: 7,
    wateredDaysAgo: 9,
  },
  {
    name: 'ZZ Plant',
    species: 'Zamioculcas zamiifolia',
    room: 'Office',
    light: 'low',
    waterEveryDays: 21,
    wateredDaysAgo: 10,
  },
  {
    name: 'Peace Lily',
    species: 'Spathiphyllum wallisii',
    room: 'Office',
    light: 'medium indirect',
    waterEveryDays: 5,
    wateredDaysAgo: 5,
  },
  // The criteria read the run day off this row (its date plus one day), so
  // its offset stays 1.
  {
    name: 'Calathea',
    species: 'Goeppertia orbifolia',
    room: 'Bedroom',
    light: 'medium indirect',
    waterEveryDays: 4,
    wateredDaysAgo: 1,
  },
  {
    name: 'Aloe Vera',
    species: 'Aloe barbadensis',
    room: 'Kitchen',
    light: 'bright direct',
    waterEveryDays: 14,
    wateredDaysAgo: 20,
  },
  {
    name: 'String of Pearls',
    species: 'Curio rowleyanus',
    room: 'Kitchen',
    light: 'bright indirect',
    waterEveryDays: 10,
    wateredDaysAgo: 2,
  },
  {
    name: 'Spider Plant',
    species: 'Chlorophytum comosum',
    room: 'Living Room',
    light: 'medium indirect',
    waterEveryDays: 6,
    wateredDaysAgo: 6,
  },
  {
    name: 'Rubber Plant',
    species: 'Ficus elastica',
    room: 'Office',
    light: 'bright indirect',
    waterEveryDays: 9,
    wateredDaysAgo: 4,
  },
  {
    name: 'Pilea',
    species: 'Pilea peperomioides',
    room: 'Bathroom',
    light: 'bright indirect',
    waterEveryDays: 7,
    wateredDaysAgo: 2,
  },
];

// A local calendar date, `YYYY-MM-DD`, `days` before `today`.
function daysBefore(today: Date, days: number): string {
  let date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  date.setDate(date.getDate() - days);
  let month = String(date.getMonth() + 1).padStart(2, '0');
  let day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function houseplantsCsv(today = new Date()): string {
  let rows = HOUSEPLANTS.map((p) =>
    [
      p.name,
      p.species,
      p.room,
      p.light,
      p.waterEveryDays,
      daysBefore(today, p.wateredDaysAgo),
    ].join(','),
  );
  return [
    'name,species,room,light,water_every_days,last_watered',
    ...rows,
    '',
  ].join('\n');
}

export function houseplantsSeed(): EvaluationSeed {
  return {
    contents: { [HOUSEPLANTS_PATH]: houseplantsCsv() },
    initialCards: [],
    promptCards: [],
    expectedChangedCards: [],
  };
}
