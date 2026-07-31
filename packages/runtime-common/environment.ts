// From https://github.com/iliakan/detect-node
export const isNode =
  Object.prototype.toString.call((globalThis as any).process) ===
  '[object process]';
