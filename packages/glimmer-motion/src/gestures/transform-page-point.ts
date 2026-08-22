/**
 * Motion's correctParentTransform / transformViewBoxPoint (utils/transform-rotated-parent.ts,
 * utils/transform-viewbox-point.ts), with the React ref replaced by an element or a {current} ref.
 */
type Point = { x: number; y: number };
type TransformPoint = (p: Point) => Point;
type Ref<T> = T | { current: T | null } | null | undefined;
const resolve = <T>(ref: Ref<T>): T | null =>
  (ref && typeof ref === 'object' && 'current' in (ref as object)
    ? (ref as { current: T | null }).current
    : (ref as T | null)) ?? null;

/** pointer coordinates corrected for a parent with a CSS transform (rotation, scale, skew) */
export function correctParentTransform(
  parentRef: Ref<Element>,
): TransformPoint {
  return (point) => {
    const parent = resolve(parentRef);
    if (!parent) {
      return point;
    }
    const inv = getInverseMatrix(parent);
    if (!inv) {
      return point;
    }
    const rect = parent.getBoundingClientRect();
    const cx = rect.left + window.scrollX + rect.width / 2;
    const cy = rect.top + window.scrollY + rect.height / 2;
    const dx = point.x - cx,
      dy = point.y - cy;
    return { x: cx + inv.a * dx + inv.c * dy, y: cy + inv.b * dx + inv.d * dy };
  };
}

function getInverseMatrix(element: Element) {
  const { transform } = getComputedStyle(element);
  if (!transform || transform === 'none') {
    return null;
  }
  const match =
    transform.match(/^matrix3d\((.*)\)$/u) ||
    transform.match(/^matrix\((.*)\)$/u);
  if (!match) {
    return null;
  }
  const v = match[1]!.split(',').map(Number);
  const is3d = transform.startsWith('matrix3d');
  const a = v[0]!,
    b = v[1]!,
    c = is3d ? v[4]! : v[2]!,
    d = is3d ? v[5]! : v[3]!;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-10) {
    return null;
  }
  return { a: d / det, b: -b / det, c: -c / det, d: a / det };
}

/** pointer coordinates scaled into an <svg>'s viewBox coordinate system */
export function transformViewBoxPoint(
  svgRef: Ref<SVGSVGElement>,
): TransformPoint {
  return (point) => {
    const svg = resolve(svgRef);
    if (!svg) {
      return point;
    }
    const viewBox = svg.viewBox?.baseVal;
    if (!viewBox || (viewBox.width === 0 && viewBox.height === 0)) {
      return point;
    }
    const bbox = svg.getBoundingClientRect();
    if (bbox.width === 0 || bbox.height === 0) {
      return point;
    }
    const scaleX = viewBox.width / bbox.width,
      scaleY = viewBox.height / bbox.height;
    const svgX = bbox.left + window.scrollX,
      svgY = bbox.top + window.scrollY;
    return {
      x: (point.x - svgX) * scaleX + svgX,
      y: (point.y - svgY) * scaleY + svgY,
    };
  };
}
