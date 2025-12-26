import {
  adjectives,
  animals,
  NumberDictionary,
  uniqueNamesGenerator,
} from 'unique-names-generator';

const numberDictionary = NumberDictionary.generate({ min: 0, max: 99 });

export function generateRandomWorkspaceName(): string {
  let includeNumber = Math.random() < 0.7;
  let dictionaries = includeNumber
    ? [adjectives, animals, numberDictionary]
    : [adjectives, animals];

  return uniqueNamesGenerator({
    dictionaries,
    separator: '-',
    style: 'lowerCase',
  });
}
