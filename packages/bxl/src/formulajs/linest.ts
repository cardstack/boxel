/**
 * LINEST and RSQ: least-squares linear regression with Excel's argument
 * shapes and result layout.
 *
 * Written for BXL rather than ported. LibreOffice Calc (MPL-2.0) and goffice
 * (GPL) served only as behavioural references for the shape rules, the stats
 * layout and collinear-column dropping; no code was copied from them.
 *
 * Numerics: when `const` is TRUE the x columns and y are centred first, then
 * the design matrix is factored by Householder QR with column pivoting. A
 * column whose pivot falls below RANK_TOLERANCE × the largest pivot is
 * treated as collinear with the columns already kept: it gets a coefficient
 * of 0 and a standard error of 0, and the degrees of freedom count only the
 * kept columns, as Excel documents. Which of two collinear columns Excel
 * drops is not documented; here the pivoting keeps the column with the
 * larger remaining norm.
 *
 * Result (Excel order, coefficients reversed):
 *   stats FALSE → [m_k, …, m_1, b]
 *   stats TRUE  → five rows of k + 1 cells:
 *     [m_k … m_1, b]
 *     [se_k … se_1, se_b]            se_b is #N/A when const is FALSE
 *     [R², se_y, #N/A …]
 *     [F, df, #N/A …]
 *     [SSreg, SSresid, #N/A …]
 * Cells Excel fills with #N/A hold the string "#N/A" (an Excel error value
 * can't sit inside a BXL array as a thrown sentinel).
 */
import { parseExcelBool } from './common.ts';
import { EXCEL_ERROR, throwExcelError } from './errors.ts';

const RANK_TOLERANCE = 1e-12;
const NA = EXCEL_ERROR.na;

type Cell = number | typeof NA;

function finiteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throwExcelError(EXCEL_ERROR.value);
  }
  return value;
}

function isMatrix(value: unknown): value is unknown[][] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((row) => Array.isArray(row))
  );
}

interface Vector {
  values: number[];
  // 'column' when y is a plain list or a one-column matrix; 'row' when it is
  // a one-row matrix. A plain JSON list reads as a column, as a worksheet
  // range of one column would.
  orientation: 'column' | 'row';
  shape: [number, number];
}

function readY(knownY: unknown): Vector {
  if (!Array.isArray(knownY) || knownY.length === 0) {
    throwExcelError(EXCEL_ERROR.value);
  }
  if (!isMatrix(knownY)) {
    let values = knownY.map(finiteNumber);
    return { values, orientation: 'column', shape: [values.length, 1] };
  }
  let rows = knownY.length;
  let cols = knownY[0].length;
  if (knownY.some((row) => row.length !== cols)) {
    throwExcelError(EXCEL_ERROR.ref);
  }
  let values = knownY.flat().map(finiteNumber);
  if (cols === 1) return { values, orientation: 'column', shape: [rows, 1] };
  if (rows === 1) return { values, orientation: 'row', shape: [1, cols] };
  // A y matrix is only valid when x has the same shape (one variable,
  // read cell by cell); readX checks that.
  return { values, orientation: 'column', shape: [rows, cols] };
}

// Returns the design as n observations × k variables.
function readX(knownX: unknown, y: Vector): number[][] {
  let n = y.values.length;
  if (knownX === undefined || knownX === null) {
    return y.values.map((_, i) => [i + 1]);
  }
  if (!Array.isArray(knownX) || knownX.length === 0) {
    throwExcelError(EXCEL_ERROR.value);
  }
  let yIsMatrix = y.shape[0] > 1 && y.shape[1] > 1;
  if (!isMatrix(knownX)) {
    // A plain list: one variable, one value per observation.
    if (knownX.length !== n || yIsMatrix) throwExcelError(EXCEL_ERROR.ref);
    return knownX.map((v) => [finiteNumber(v)]);
  }
  let rows = knownX.length;
  let cols = knownX[0].length;
  if (knownX.some((row) => row.length !== cols)) {
    throwExcelError(EXCEL_ERROR.ref);
  }
  if (yIsMatrix || (rows === y.shape[0] && cols === y.shape[1])) {
    // Same shape as y: one variable, matched cell by cell.
    if (rows !== y.shape[0] || cols !== y.shape[1]) {
      throwExcelError(EXCEL_ERROR.ref);
    }
    return knownX.flat().map((v) => [finiteNumber(v)]);
  }
  if (y.orientation === 'column') {
    // Each column of x is a variable; one row per observation.
    if (rows !== n) throwExcelError(EXCEL_ERROR.ref);
    return knownX.map((row) => row.map(finiteNumber));
  }
  // y is a row: each row of x is a variable; one column per observation.
  if (cols !== n) throwExcelError(EXCEL_ERROR.ref);
  return Array.from({ length: n }, (_, i) =>
    knownX.map((row) => finiteNumber(row[i])),
  );
}

interface Fit {
  coefficients: number[]; // m_1 … m_k, in variable order
  intercept: number;
  standardErrors: number[]; // se_1 … se_k
  interceptError: Cell;
  rSquared: Cell;
  standardErrorY: Cell;
  fStatistic: Cell;
  degreesOfFreedom: number;
  ssReg: number;
  ssResid: number;
}

function fit(y: number[], x: number[][], withConstant: boolean): Fit {
  let n = y.length;
  let k = x[0]?.length ?? 0;
  if (k === 0) throwExcelError(EXCEL_ERROR.value);
  if (n < (withConstant ? 2 : 1)) throwExcelError(EXCEL_ERROR.num);

  let xMeans = new Array<number>(k).fill(0);
  let yMean = 0;
  if (withConstant) {
    for (let i = 0; i < n; i++) {
      yMean += y[i];
      for (let j = 0; j < k; j++) xMeans[j] += x[i][j];
    }
    yMean /= n;
    for (let j = 0; j < k; j++) xMeans[j] /= n;
  }
  // A is column-major so Householder steps touch contiguous columns.
  let A = Array.from({ length: k }, (_, j) =>
    Array.from({ length: n }, (_, i) => x[i][j] - xMeans[j]),
  );
  let qty = y.map((v) => v - yMean);
  let perm = Array.from({ length: k }, (_, j) => j);
  let norms = A.map((col) => Math.hypot(...col));
  let firstPivot = 0;
  let rank = 0;

  for (let step = 0; step < Math.min(n, k); step++) {
    // Pivot: the remaining column with the largest norm below row `step`.
    let best = step;
    for (let j = step + 1; j < k; j++) if (norms[j] > norms[best]) best = j;
    if (best !== step) {
      [A[step], A[best]] = [A[best], A[step]];
      [perm[step], perm[best]] = [perm[best], perm[step]];
      [norms[step], norms[best]] = [norms[best], norms[step]];
    }
    let col = A[step];
    let alpha = 0;
    for (let i = step; i < n; i++) alpha += col[i] * col[i];
    alpha = Math.sqrt(alpha);
    if (step === 0) firstPivot = alpha;
    if (alpha === 0 || alpha <= RANK_TOLERANCE * firstPivot) break;
    if (col[step] > 0) alpha = -alpha;
    // v = col[step..] - alpha·e1, stored in place; R[step][step] = alpha.
    col[step] -= alpha;
    let vNorm2 = 0;
    for (let i = step; i < n; i++) vNorm2 += col[i] * col[i];
    let reflect = (target: number[]) => {
      let dot = 0;
      for (let i = step; i < n; i++) dot += col[i] * target[i];
      let scale = (2 * dot) / vNorm2;
      for (let i = step; i < n; i++) target[i] -= scale * col[i];
    };
    for (let j = step + 1; j < k; j++) {
      reflect(A[j]);
      let rest = 0;
      for (let i = step + 1; i < n; i++) rest += A[j][i] * A[j][i];
      norms[j] = Math.sqrt(rest);
    }
    reflect(qty);
    // Keep v for nothing further; store R's diagonal where it belongs.
    for (let i = step + 1; i < n; i++) col[i] = 0;
    col[step] = alpha;
    rank++;
  }

  // R is the upper-left rank × rank block: R[r][c] = A[c][r] for r <= c.
  let R = (r: number, c: number) => A[c][r];
  let beta = new Array<number>(rank).fill(0);
  for (let r = rank - 1; r >= 0; r--) {
    let s = qty[r];
    for (let c = r + 1; c < rank; c++) s -= R(r, c) * beta[c];
    beta[r] = s / R(r, r);
  }
  // Rinv (upper triangular), for (RᵀR)⁻¹ = Rinv·Rinvᵀ.
  let Rinv = Array.from({ length: rank }, () =>
    new Array<number>(rank).fill(0),
  );
  for (let c = 0; c < rank; c++) {
    Rinv[c][c] = 1 / R(c, c);
    for (let r = c - 1; r >= 0; r--) {
      let s = 0;
      for (let m = r + 1; m <= c; m++) s += R(r, m) * Rinv[m][c];
      Rinv[r][c] = -s / R(r, r);
    }
  }
  let covUnscaled = (a: number, b: number) => {
    let s = 0;
    for (let m = Math.max(a, b); m < rank; m++) s += Rinv[a][m] * Rinv[b][m];
    return s;
  };

  let coefficients = new Array<number>(k).fill(0);
  for (let p = 0; p < rank; p++) coefficients[perm[p]] = beta[p];
  let intercept = withConstant
    ? yMean - coefficients.reduce((s, m, j) => s + m * xMeans[j], 0)
    : 0;

  let ssResid = 0;
  let ssTotal = 0;
  for (let i = 0; i < n; i++) {
    let predicted = intercept;
    for (let j = 0; j < k; j++) predicted += coefficients[j] * x[i][j];
    ssResid += (y[i] - predicted) ** 2;
    ssTotal += withConstant ? (y[i] - yMean) ** 2 : y[i] ** 2;
  }
  // An exact fit leaves round-off in the residual; treat it as zero so the
  // stats read as an exact fit (se 0, R² 1, F #N/A) instead of noise.
  let scale = withConstant ? ssTotal : y.reduce((s, v) => s + v * v, 0);
  if (ssResid <= 1e-24 * Math.max(scale, Number.MIN_VALUE)) ssResid = 0;
  let ssReg = Math.max(0, ssTotal - ssResid);
  let df = n - rank - (withConstant ? 1 : 0);

  let rSquared: Cell =
    ssTotal === 0 ? (ssResid === 0 ? 1 : NA) : ssReg / ssTotal;
  let variance = df > 0 ? ssResid / df : NaN;
  let standardErrorY: Cell = df > 0 ? Math.sqrt(variance) : NA;
  let fStatistic: Cell =
    df > 0 && rank > 0 && ssResid > 0 ? ssReg / rank / variance : NA;

  let standardErrors = new Array<number>(k).fill(0);
  if (df > 0) {
    for (let p = 0; p < rank; p++) {
      standardErrors[perm[p]] = Math.sqrt(variance * covUnscaled(p, p));
    }
  }
  let interceptError: Cell = NA;
  if (withConstant && df > 0) {
    // Var(b) = σ²·(1/n + x̄ᵀ (XcᵀXc)⁻¹ x̄), over the kept columns.
    let quad = 0;
    for (let a = 0; a < rank; a++) {
      for (let b = 0; b < rank; b++) {
        quad += xMeans[perm[a]] * covUnscaled(a, b) * xMeans[perm[b]];
      }
    }
    interceptError = Math.sqrt(variance * (1 / n + quad));
  }

  return {
    coefficients,
    intercept,
    standardErrors,
    interceptError,
    rSquared,
    standardErrorY,
    fStatistic,
    degreesOfFreedom: df,
    ssReg,
    ssResid,
  };
}

export function linest(
  knownY: unknown,
  knownX?: unknown,
  constLike: unknown = true,
  statsLike: unknown = false,
): Cell[] | Cell[][] {
  let withConstant =
    constLike === undefined || constLike === null
      ? true
      : parseExcelBool(constLike);
  let withStats =
    statsLike === undefined || statsLike === null
      ? false
      : parseExcelBool(statsLike);
  let y = readY(knownY);
  let x = readX(knownX, y);
  let result = fit(y.values, x, withConstant);
  let width = result.coefficients.length + 1;
  let row1: Cell[] = [...result.coefficients]
    .reverse()
    .concat(result.intercept);
  if (!withStats) return row1;
  let pad = (cells: Cell[]) =>
    cells.concat(new Array<Cell>(width - cells.length).fill(NA));
  let noStats = result.degreesOfFreedom <= 0;
  return [
    row1,
    [
      ...[...result.standardErrors]
        .reverse()
        .map((se): Cell => (noStats ? NA : se)),
      result.interceptError,
    ],
    pad([result.rSquared, result.standardErrorY]),
    pad([result.fStatistic, result.degreesOfFreedom]),
    pad([result.ssReg, result.ssResid]),
  ];
}

export function rsq(knownY: unknown, knownX: unknown): number {
  let y = readY(knownY).values;
  let x = Array.isArray(knownX) ? knownX.flat().map(finiteNumber) : [];
  if (x.length !== y.length) throwExcelError(EXCEL_ERROR.na);
  let n = y.length;
  if (n < 2) throwExcelError(EXCEL_ERROR.div0);
  let meanX = x.reduce((a, b) => a + b, 0) / n;
  let meanY = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - meanX) * (y[i] - meanY);
    sxx += (x[i] - meanX) ** 2;
    syy += (y[i] - meanY) ** 2;
  }
  if (sxx === 0 || syy === 0) throwExcelError(EXCEL_ERROR.div0);
  return (sxy * sxy) / (sxx * syy);
}
