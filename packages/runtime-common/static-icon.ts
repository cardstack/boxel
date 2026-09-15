// An icon representation, produced alongside the component by the icon build.
// Its revision is independent of the data records that use that component.
export interface StaticIconSvg {
  svg: string;
  contentHash: string;
}

export const staticIconSvg = Symbol.for('boxel:static-icon-svg');
