let labelToTime = new Map<string, number>();

export async function time(label: string, promise: Promise<any>) {
  let now = performance.now();

  let result = await promise;

  let diff = performance.now() - now;
  let lastTime = labelToTime.get(label) || 0;
  labelToTime.set(label, lastTime + diff);

  return result;
}

export function getTimes() {
  return labelToTime;
}
