import { generateCombinations } from './generateCombinations.js';

/**
 * @param potentialEntries Like entries, except that each entry key/value should get an array of possible evaluations.
 *    E.g. [ [["a","b"],[1,2]], [["x"],[0]] ] --> {a:1,x:0}, {a:2,x:0}, {b:1,x:0}, {b:2,x:0}
 */
export function* generateObjects(
  potentialEntries: [any[], any[]][]
): IterableIterator<any[]> {
  const flatPotentialEntries = potentialEntries.flat();
  for (const combination of generateCombinations(flatPotentialEntries)) {
    yield buildObject(combination);
  }
}

function buildObject(flatEntries: any[]): any {
  const entries = flatEntries.reduce((acc, item, i) => {
    if (i % 2 === 0) {
      acc.push([item]);
    } else {
      acc[acc.length - 1].push(item);
    }
    return acc;
  }, []);

  return Object.fromEntries(entries);
}
