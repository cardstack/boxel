let labelToTime = new Map<string, number>();

export async function time(
  label: string,
  promiseOrFunction: Promise<any> | (() => Promise<any>) | (() => any),
) {
  let now = performance.now();

  let result;
  try {
    if (typeof promiseOrFunction === 'function') {
      result = await promiseOrFunction();
    } else {
      result = await promiseOrFunction;
    }
  } finally {
    let diff = performance.now() - now;
    let lastTime = labelToTime.get(label) || 0;
    labelToTime.set(label, lastTime + diff);

    return result;
  }
}

export function getTimes() {
  return labelToTime;
}
