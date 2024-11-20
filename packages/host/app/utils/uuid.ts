const flickrBase58 =
  '123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

export function shortenUuid(v4Uuid: string): string {
  // shorten it using flickrBase58
  let num = BigInt('0x' + v4Uuid.replace(/-/g, ''));
  let shortUuid = '';
  while (num > 0) {
    shortUuid = flickrBase58[Number(num % 58n)] + shortUuid;
    num /= 58n;
  }
  return shortUuid;
}
