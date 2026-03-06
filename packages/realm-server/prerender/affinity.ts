import type { AffinityArgs } from '@cardstack/runtime-common';

export function toAffinityKey({
  affinityType,
  affinityValue,
}: AffinityArgs): string {
  return `${affinityType}:${affinityValue}`;
}

export function fromAffinityKey(affinityKey: string): AffinityArgs | undefined {
  let separator = affinityKey.indexOf(':');
  if (separator <= 0) {
    return;
  }
  let affinityType = affinityKey.slice(0, separator);
  if (affinityType !== 'realm' && affinityType !== 'user') {
    return;
  }
  return {
    affinityType,
    affinityValue: affinityKey.slice(separator + 1),
  };
}
