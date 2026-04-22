export function* generateCombinations<T>(sets: T[][]) {
  const counters = sets.map((_) => 0);
  do {
    yield buildCombination(sets, counters);
  } while (increaseCounters(sets, counters));
}

function buildCombination<T>(sets: T[][], counters: number[]) {
  return counters.map((counter, i) => sets[i][counter]);
}

function increaseCounters(sets: any[][], counters: number[]) {
  for (let i = counters.length - 1; i >= 0; i--) {
    counters[i]++;
    if (counters[i] < sets[i].length) {
      return true;
    }
    counters[i] = 0;
  }

  return false;
}
