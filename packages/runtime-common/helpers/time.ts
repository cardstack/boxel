let labelToTime = new Map<string, number>();
let labelToStartTime = new Map<string, number>();

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

export async function timeStart(label: string) {
  labelToStartTime.set(label, performance.now());
}

export async function timeEnd(label: string) {
  let now = performance.now();
  let startTime = labelToStartTime.get(label);
  if (startTime === undefined) {
    console.error(`No start time found for label ${label}`);
    return NaN;
  }

  let diff = now - startTime;
  let lastTime = labelToTime.get(label) || 0;
  labelToTime.set(label, lastTime + diff);

  labelToStartTime.delete(label);

  return diff;
}

export function getTimes() {
  return labelToTime;
}
