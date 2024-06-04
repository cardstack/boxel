import isEqual from 'lodash/isEqual';

// TODO let's use better types for cardData and patchData here
export function isPatchApplied(
  cardData: Record<string, any> | undefined,
  patchData: Record<string, any>,
  relativeTo: string,
): boolean {
  if (!cardData || !patchData) {
    return false;
  }
  if (isEqual(cardData, patchData)) {
    return true;
  }
  if (!Object.keys(patchData).length) {
    return false;
  }
  for (let [key, patchValue] of Object.entries(patchData)) {
    if (!(key in cardData)) {
      return false;
    }
    let cardValue = cardData[key];
    if (cardValue?.links?.self === null && isEqual(patchValue, [])) {
      return true;
    }
    if (
      !isEqual(cardValue, patchValue) &&
      typeof cardValue === 'object' &&
      typeof patchValue === 'object'
    ) {
      if (key === 'attributes' && !Object.keys(patchValue).length) {
        continue;
      }
      if (!isPatchApplied(cardValue, patchValue, relativeTo)) {
        return false;
      }
    } else if (!isEqual(cardValue, patchValue)) {
      try {
        return (
          new URL(cardValue, relativeTo).href ===
          new URL(patchValue, relativeTo).href
        );
      } catch (e) {
        return false;
      }
    }
  }
  return true;
}
