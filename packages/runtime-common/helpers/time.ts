let labelToTime = new Map<string, number>();

export async function time(
  label: string,
  promiseOrFunction: Promise<any> | (() => Promise<any>) | (() => any),
) {
  let now = performance.now();

  let result;
  if (typeof promiseOrFunction === 'function') {
    result = promiseOrFunction();
  } else {
    result = await promiseOrFunction;
  }

  let diff = performance.now() - now;
  let lastTime = labelToTime.get(label) || 0;
  labelToTime.set(label, lastTime + diff);

  return result;
}

export function getTimes() {
  return labelToTime;
}
