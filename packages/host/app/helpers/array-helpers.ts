export function reverse<T>(arr: T[]): T[] {
  //Avoids error when reverse directly on tracked array
  let result = [...arr];
  return result.reverse();
}
