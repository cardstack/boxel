const ROOM_ID_PREFIX = 'room-';

function toBase64Url(input: string): string {
  let base64 =
    typeof btoa === 'function'
      ? btoa(input)
      : Buffer.from(input, 'utf8').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  let padding = base64.length % 4;
  if (padding !== 0) {
    base64 += '='.repeat(4 - padding);
  }
  return typeof atob === 'function'
    ? atob(base64)
    : Buffer.from(base64, 'base64').toString('utf8');
}

export function matrixRoomIdToBranchName(matrixRoomId: string): string {
  if (!matrixRoomId) {
    throw new Error('matrixRoomId is required');
  }
  return `${ROOM_ID_PREFIX}${toBase64Url(matrixRoomId)}`;
}

function toKebabSlug(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function toBranchName(
  matrixRoomId: string,
  listingName: string,
): string {
  if (!listingName) {
    throw new Error('listingName is required');
  }
  let roomPrefix = matrixRoomIdToBranchName(matrixRoomId);
  let listingSlug = toKebabSlug(listingName);
  return listingSlug ? `${roomPrefix}/${listingSlug}` : roomPrefix;
}

export function branchNameToMatrixRoomId(branchName: string): string {
  if (!branchName) {
    throw new Error('branchName is required');
  }
  let roomSegment = branchName.split('/')[0];
  if (!roomSegment.startsWith(ROOM_ID_PREFIX)) {
    throw new Error('branchName does not include a matrix room id prefix');
  }
  let encoded = roomSegment.slice(ROOM_ID_PREFIX.length);
  if (!encoded) {
    throw new Error('branchName has no encoded matrix room id');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error('branchName has an invalid encoded matrix room id');
  }
  try {
    return fromBase64Url(encoded);
  } catch (error) {
    throw new Error('branchName has an invalid encoded matrix room id');
  }
}
