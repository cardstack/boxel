import jStatImport from 'jstat';

import {
  flattenExcelArgs,
  parseExcelBool,
  parseExcelNumber,
  parseExcelNumberArray,
} from './common.js';
import { EXCEL_ERROR, throwExcelError } from './errors.js';

const jStat = jStatImport as any;

function checkedNumber(value: number) {
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return value;
}

function factorial(value: number): number {
  const n = Math.floor(value);
  if (n < 0) {
    throwExcelError(EXCEL_ERROR.num);
  }
  let result = 1;
  for (let index = 2; index <= n; index++) {
    result *= index;
  }
  return checkedNumber(result);
}

function combin(number: number, chosen: number): number {
  const n = Math.floor(number);
  const k = Math.floor(chosen);
  if (n < 0 || k < 0 || k > n) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(factorial(n) / (factorial(k) * factorial(n - k)));
}

function finiteNumbers(value: unknown): number[] {
  const numbers = parseExcelNumberArray(value);
  if (numbers.some((entry) => !Number.isFinite(entry))) {
    throwExcelError(EXCEL_ERROR.value);
  }
  return numbers;
}

function numericMatrix(value: unknown): number[][] {
  if (!Array.isArray(value)) {
    throwExcelError(EXCEL_ERROR.value);
  }
  const rows = value.map((row) =>
    Array.isArray(row)
      ? row.map((entry) => parseExcelNumber(entry))
      : [parseExcelNumber(row)],
  );
  if (rows.length === 0 || rows.some((row) => row.length === 0)) {
    throwExcelError(EXCEL_ERROR.value);
  }
  const width = rows[0]!.length;
  if (rows.some((row) => row.length !== width)) {
    throwExcelError(EXCEL_ERROR.value);
  }
  return rows;
}

export function excelBetaDist(
  xLike: unknown,
  alphaLike: unknown,
  betaLike: unknown,
  cumulativeLike: unknown,
  aLike: unknown = 0,
  bLike: unknown = 1,
) {
  const x = parseExcelNumber(xLike);
  const alpha = parseExcelNumber(alphaLike);
  const beta = parseExcelNumber(betaLike);
  const a = parseExcelNumber(aLike);
  const b = parseExcelNumber(bLike);
  const cumulative = parseExcelBool(cumulativeLike);
  if (alpha <= 0 || beta <= 0 || a === b || x < a || x > b) {
    throwExcelError(EXCEL_ERROR.num);
  }
  const scaled = (x - a) / (b - a);
  return checkedNumber(
    cumulative ? jStat.beta.cdf(scaled, alpha, beta) : jStat.beta.pdf(scaled, alpha, beta),
  );
}

export function excelBetaInv(
  probabilityLike: unknown,
  alphaLike: unknown,
  betaLike: unknown,
  aLike: unknown = 0,
  bLike: unknown = 1,
) {
  const probability = parseExcelNumber(probabilityLike);
  const alpha = parseExcelNumber(alphaLike);
  const beta = parseExcelNumber(betaLike);
  const a = parseExcelNumber(aLike);
  const b = parseExcelNumber(bLike);
  if (probability < 0 || probability > 1 || alpha <= 0 || beta <= 0 || a === b) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(jStat.beta.inv(probability, alpha, beta) * (b - a) + a);
}

export function excelBinomDist(
  numberSLike: unknown,
  trialsLike: unknown,
  probabilitySLike: unknown,
  cumulativeLike: unknown,
) {
  const numberS = Math.floor(parseExcelNumber(numberSLike));
  const trials = Math.floor(parseExcelNumber(trialsLike));
  const probabilityS = parseExcelNumber(probabilitySLike);
  const cumulative = parseExcelBool(cumulativeLike);
  if (numberS < 0 || trials < 0 || numberS > trials || probabilityS < 0 || probabilityS > 1) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(
    cumulative
      ? jStat.binomial.cdf(numberS, trials, probabilityS)
      : jStat.binomial.pdf(numberS, trials, probabilityS),
  );
}

export function excelBinomDistRange(
  trialsLike: unknown,
  probabilitySLike: unknown,
  numberSLike: unknown,
  numberS2Like: unknown = numberSLike,
) {
  const trials = Math.floor(parseExcelNumber(trialsLike));
  const probabilityS = parseExcelNumber(probabilitySLike);
  const numberS = Math.floor(parseExcelNumber(numberSLike));
  const numberS2 = Math.floor(parseExcelNumber(numberS2Like));
  if (
    trials < 0 ||
    probabilityS < 0 ||
    probabilityS > 1 ||
    numberS < 0 ||
    numberS2 < numberS ||
    numberS2 > trials
  ) {
    throwExcelError(EXCEL_ERROR.num);
  }
  let result = 0;
  for (let index = numberS; index <= numberS2; index++) {
    result += combin(trials, index) * probabilityS ** index * (1 - probabilityS) ** (trials - index);
  }
  return checkedNumber(result);
}

export function excelBinomInv(
  trialsLike: unknown,
  probabilitySLike: unknown,
  alphaLike: unknown,
) {
  const trials = Math.floor(parseExcelNumber(trialsLike));
  const probabilityS = parseExcelNumber(probabilitySLike);
  const alpha = parseExcelNumber(alphaLike);
  if (trials < 0 || probabilityS < 0 || probabilityS > 1 || alpha < 0 || alpha > 1) {
    throwExcelError(EXCEL_ERROR.num);
  }
  for (let value = 0; value <= trials; value++) {
    if (jStat.binomial.cdf(value, trials, probabilityS) >= alpha) {
      return value;
    }
  }
  return trials;
}

export function excelChisqDist(
  xLike: unknown,
  degFreedomLike: unknown,
  cumulativeLike: unknown,
) {
  const x = parseExcelNumber(xLike);
  const degFreedom = parseExcelNumber(degFreedomLike);
  const cumulative = parseExcelBool(cumulativeLike);
  if (x < 0 || degFreedom < 1) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(
    cumulative
      ? jStat.chisquare.cdf(x, degFreedom)
      : jStat.chisquare.pdf(x, degFreedom),
  );
}

export function excelChisqDistRt(xLike: unknown, degFreedomLike: unknown) {
  const x = parseExcelNumber(xLike);
  const degFreedom = parseExcelNumber(degFreedomLike);
  if (x < 0 || degFreedom < 1 || degFreedom > 1.0e10) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(1 - jStat.chisquare.cdf(x, degFreedom));
}

export function excelChisqInv(probabilityLike: unknown, degFreedomLike: unknown) {
  const probability = parseExcelNumber(probabilityLike);
  const degFreedom = parseExcelNumber(degFreedomLike);
  if (probability < 0 || probability > 1 || degFreedom < 1) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(jStat.chisquare.inv(probability, degFreedom));
}

export function excelChisqInvRt(
  probabilityLike: unknown,
  degFreedomLike: unknown,
) {
  const probability = parseExcelNumber(probabilityLike);
  const degFreedom = parseExcelNumber(degFreedomLike);
  if (probability < 0 || probability > 1 || degFreedom < 1 || degFreedom > 1.0e10) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(jStat.chisquare.inv(1 - probability, degFreedom));
}

export function excelChisqTest(actualLike: unknown, expectedLike: unknown) {
  const actual = numericMatrix(actualLike);
  const expected = numericMatrix(expectedLike);
  if (
    actual.length !== expected.length ||
    actual[0]!.length !== expected[0]!.length
  ) {
    throwExcelError(EXCEL_ERROR.value);
  }
  const rows = actual.length;
  const cols = actual[0]!.length;
  const degrees = cols === 1 ? rows - 1 : (rows - 1) * (cols - 1);
  let statistic = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (expected[row]![col] === 0) {
        throwExcelError(EXCEL_ERROR.div0);
      }
      statistic += (actual[row]![col]! - expected[row]![col]!) ** 2 / expected[row]![col]!;
    }
  }
  return checkedNumber(1 - jStat.chisquare.cdf(statistic, degrees));
}

export function excelConfidenceNorm(
  alphaLike: unknown,
  standardDevLike: unknown,
  sizeLike: unknown,
) {
  const alpha = parseExcelNumber(alphaLike);
  const standardDev = parseExcelNumber(standardDevLike);
  const size = parseExcelNumber(sizeLike);
  if (alpha <= 0 || alpha >= 1 || standardDev <= 0 || size < 1) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(jStat.normalci(1, alpha, standardDev, size)[1] - 1);
}

export function excelConfidenceT(
  alphaLike: unknown,
  standardDevLike: unknown,
  sizeLike: unknown,
) {
  const alpha = parseExcelNumber(alphaLike);
  const standardDev = parseExcelNumber(standardDevLike);
  const size = parseExcelNumber(sizeLike);
  if (alpha <= 0 || alpha >= 1 || standardDev <= 0 || size < 1) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(jStat.tci(1, alpha, standardDev, size)[1] - 1);
}

export function excelExponDist(
  xLike: unknown,
  lambdaLike: unknown,
  cumulativeLike: unknown,
) {
  const x = parseExcelNumber(xLike);
  const lambda = parseExcelNumber(lambdaLike);
  const cumulative = parseExcelBool(cumulativeLike);
  if (x < 0 || lambda <= 0) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(
    cumulative
      ? jStat.exponential.cdf(x, lambda)
      : jStat.exponential.pdf(x, lambda),
  );
}

export function excelFDist(
  xLike: unknown,
  degFreedom1Like: unknown,
  degFreedom2Like: unknown,
  cumulativeLike: unknown,
) {
  const x = parseExcelNumber(xLike);
  const degFreedom1 = parseExcelNumber(degFreedom1Like);
  const degFreedom2 = parseExcelNumber(degFreedom2Like);
  const cumulative = parseExcelBool(cumulativeLike);
  if (x < 0 || degFreedom1 < 1 || degFreedom2 < 1) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(
    cumulative
      ? jStat.centralF.cdf(x, degFreedom1, degFreedom2)
      : jStat.centralF.pdf(x, degFreedom1, degFreedom2),
  );
}

export function excelFDistRt(
  xLike: unknown,
  degFreedom1Like: unknown,
  degFreedom2Like: unknown,
) {
  const x = parseExcelNumber(xLike);
  const degFreedom1 = parseExcelNumber(degFreedom1Like);
  const degFreedom2 = parseExcelNumber(degFreedom2Like);
  if (x < 0 || degFreedom1 < 1 || degFreedom2 < 1) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(1 - jStat.centralF.cdf(x, degFreedom1, degFreedom2));
}

export function excelFInv(
  probabilityLike: unknown,
  degFreedom1Like: unknown,
  degFreedom2Like: unknown,
) {
  const probability = parseExcelNumber(probabilityLike);
  const degFreedom1 = parseExcelNumber(degFreedom1Like);
  const degFreedom2 = parseExcelNumber(degFreedom2Like);
  if (probability < 0 || probability > 1 || degFreedom1 < 1 || degFreedom2 < 1) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(jStat.centralF.inv(probability, degFreedom1, degFreedom2));
}

export function excelFInvRt(
  probabilityLike: unknown,
  degFreedom1Like: unknown,
  degFreedom2Like: unknown,
) {
  const probability = parseExcelNumber(probabilityLike);
  const degFreedom1 = parseExcelNumber(degFreedom1Like);
  const degFreedom2 = parseExcelNumber(degFreedom2Like);
  if (probability < 0 || probability > 1 || degFreedom1 < 1 || degFreedom2 < 1) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(jStat.centralF.inv(1 - probability, degFreedom1, degFreedom2));
}

export function excelFTest(array1Like: unknown, array2Like: unknown) {
  const array1 = finiteNumbers(array1Like);
  const array2 = finiteNumbers(array2Like);
  if (array1.length < 2 || array2.length < 2) {
    throwExcelError(EXCEL_ERROR.div0);
  }
  const variance1 = jStat.variance(array1, true);
  const variance2 = jStat.variance(array2, true);
  const statistic = variance1 > variance2 ? variance1 / variance2 : variance2 / variance1;
  return checkedNumber(
    (1 - jStat.centralF.cdf(statistic, array1.length - 1, array2.length - 1)) * 2,
  );
}

export function excelGamma(valueLike: unknown) {
  const value = parseExcelNumber(valueLike);
  if (value <= 0 && Math.floor(value) === value) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(jStat.gammafn(value));
}

export function excelGammaDist(
  valueLike: unknown,
  alphaLike: unknown,
  betaLike: unknown,
  cumulativeLike: unknown,
) {
  const value = parseExcelNumber(valueLike);
  const alpha = parseExcelNumber(alphaLike);
  const beta = parseExcelNumber(betaLike);
  const cumulative = parseExcelBool(cumulativeLike);
  if (value < 0 || alpha <= 0 || beta <= 0) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(
    cumulative ? jStat.gamma.cdf(value, alpha, beta) : jStat.gamma.pdf(value, alpha, beta),
  );
}

export function excelGammaInv(
  probabilityLike: unknown,
  alphaLike: unknown,
  betaLike: unknown,
) {
  const probability = parseExcelNumber(probabilityLike);
  const alpha = parseExcelNumber(alphaLike);
  const beta = parseExcelNumber(betaLike);
  if (probability < 0 || probability > 1 || alpha <= 0 || beta <= 0) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(jStat.gamma.inv(probability, alpha, beta));
}

export function excelGammaln(valueLike: unknown) {
  const value = parseExcelNumber(valueLike);
  if (value <= 0) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(jStat.gammaln(value));
}

export function excelGauss(zLike: unknown) {
  const z = parseExcelNumber(zLike);
  return checkedNumber(jStat.normal.cdf(z, 0, 1) - 0.5);
}

export function excelHypgeomDist(
  sampleSLike: unknown,
  numberSampleLike: unknown,
  populationSLike: unknown,
  numberPopLike: unknown,
  cumulativeLike: unknown,
) {
  const sampleS = Math.floor(parseExcelNumber(sampleSLike));
  const numberSample = Math.floor(parseExcelNumber(numberSampleLike));
  const populationS = Math.floor(parseExcelNumber(populationSLike));
  const numberPop = Math.floor(parseExcelNumber(numberPopLike));
  const cumulative = parseExcelBool(cumulativeLike);
  if (
    sampleS < 0 ||
    numberSample < 0 ||
    populationS < 0 ||
    numberPop < 0 ||
    sampleS > populationS ||
    numberSample > numberPop ||
    populationS > numberPop
  ) {
    throwExcelError(EXCEL_ERROR.num);
  }
  if (cumulative) {
    let result = 0;
    for (let index = 0; index <= sampleS; index++) {
      result += jStat.hypgeom.pdf(index, numberPop, populationS, numberSample);
    }
    return checkedNumber(result);
  }
  return checkedNumber(jStat.hypgeom.pdf(sampleS, numberPop, populationS, numberSample));
}

export function excelLognormDist(
  xLike: unknown,
  meanLike: unknown,
  standardDevLike: unknown,
  cumulativeLike: unknown,
) {
  const x = parseExcelNumber(xLike);
  const mean = parseExcelNumber(meanLike);
  const standardDev = parseExcelNumber(standardDevLike);
  const cumulative = parseExcelBool(cumulativeLike);
  if (x <= 0 || standardDev <= 0) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(
    cumulative
      ? jStat.lognormal.cdf(x, mean, standardDev)
      : jStat.lognormal.pdf(x, mean, standardDev),
  );
}

export function excelLognormInv(
  probabilityLike: unknown,
  meanLike: unknown,
  standardDevLike: unknown,
) {
  const probability = parseExcelNumber(probabilityLike);
  const mean = parseExcelNumber(meanLike);
  const standardDev = parseExcelNumber(standardDevLike);
  if (probability < 0 || probability > 1 || standardDev <= 0) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(jStat.lognormal.inv(probability, mean, standardDev));
}

export function excelNegbinomDist(
  numberFLike: unknown,
  numberSLike: unknown,
  probabilitySLike: unknown,
  cumulativeLike: unknown,
) {
  const numberF = Math.floor(parseExcelNumber(numberFLike));
  const numberS = Math.floor(parseExcelNumber(numberSLike));
  const probabilityS = parseExcelNumber(probabilitySLike);
  const cumulative = parseExcelBool(cumulativeLike);
  if (numberF < 0 || numberS < 1 || probabilityS < 0 || probabilityS > 1) {
    throwExcelError(EXCEL_ERROR.num);
  }
  if (cumulative) {
    let result = 0;
    for (let index = 0; index <= numberF; index++) {
      result += jStat.negbin.pdf(index, numberS, probabilityS);
    }
    return checkedNumber(result);
  }
  return checkedNumber(jStat.negbin.pdf(numberF, numberS, probabilityS));
}

export function excelNormDist(
  xLike: unknown,
  meanLike: unknown,
  standardDevLike: unknown,
  cumulativeLike: unknown,
) {
  const x = parseExcelNumber(xLike);
  const mean = parseExcelNumber(meanLike);
  const standardDev = parseExcelNumber(standardDevLike);
  const cumulative = parseExcelBool(cumulativeLike);
  if (standardDev <= 0) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(
    cumulative ? jStat.normal.cdf(x, mean, standardDev) : jStat.normal.pdf(x, mean, standardDev),
  );
}

export function excelNormInv(
  probabilityLike: unknown,
  meanLike: unknown,
  standardDevLike: unknown,
) {
  const probability = parseExcelNumber(probabilityLike);
  const mean = parseExcelNumber(meanLike);
  const standardDev = parseExcelNumber(standardDevLike);
  if (probability < 0 || probability > 1 || standardDev <= 0) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(jStat.normal.inv(probability, mean, standardDev));
}

export function excelNormSDist(zLike: unknown, cumulativeLike: unknown) {
  return excelNormDist(zLike, 0, 1, cumulativeLike);
}

export function excelNormSInv(probabilityLike: unknown) {
  return excelNormInv(probabilityLike, 0, 1);
}

export function excelPhi(xLike: unknown) {
  const x = parseExcelNumber(xLike);
  return checkedNumber(Math.exp(-0.5 * x ** 2) / Math.sqrt(2 * Math.PI));
}

export function excelPoissonDist(
  xLike: unknown,
  meanLike: unknown,
  cumulativeLike: unknown,
) {
  const x = Math.floor(parseExcelNumber(xLike));
  const mean = parseExcelNumber(meanLike);
  const cumulative = parseExcelBool(cumulativeLike);
  if (x < 0 || mean <= 0) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(
    cumulative ? jStat.poisson.cdf(x, mean) : jStat.poisson.pdf(x, mean),
  );
}

export function excelStandardize(
  xLike: unknown,
  meanLike: unknown,
  standardDevLike: unknown,
) {
  const x = parseExcelNumber(xLike);
  const mean = parseExcelNumber(meanLike);
  const standardDev = parseExcelNumber(standardDevLike);
  if (standardDev <= 0) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber((x - mean) / standardDev);
}

export function excelTDist(
  xLike: unknown,
  degFreedomLike: unknown,
  cumulativeLike: unknown,
) {
  const x = parseExcelNumber(xLike);
  const degFreedom = parseExcelNumber(degFreedomLike);
  const cumulative = parseExcelBool(cumulativeLike);
  if (degFreedom < 1) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(
    cumulative ? jStat.studentt.cdf(x, degFreedom) : jStat.studentt.pdf(x, degFreedom),
  );
}

export function excelTDist2T(xLike: unknown, degFreedomLike: unknown) {
  const x = parseExcelNumber(xLike);
  const degFreedom = parseExcelNumber(degFreedomLike);
  if (x < 0 || degFreedom < 1) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber((1 - jStat.studentt.cdf(x, degFreedom)) * 2);
}

export function excelTDistRt(xLike: unknown, degFreedomLike: unknown) {
  const x = parseExcelNumber(xLike);
  const degFreedom = parseExcelNumber(degFreedomLike);
  if (x < 0 || degFreedom < 1) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(1 - jStat.studentt.cdf(x, degFreedom));
}

export function excelTInv(probabilityLike: unknown, degFreedomLike: unknown) {
  const probability = parseExcelNumber(probabilityLike);
  const degFreedom = parseExcelNumber(degFreedomLike);
  if (probability < 0 || probability > 1 || degFreedom < 1) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(jStat.studentt.inv(probability, degFreedom));
}

export function excelTInv2T(probabilityLike: unknown, degFreedomLike: unknown) {
  const probability = parseExcelNumber(probabilityLike);
  const degFreedom = parseExcelNumber(degFreedomLike);
  if (probability <= 0 || probability > 1 || degFreedom < 1) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(Math.abs(jStat.studentt.inv(probability / 2, degFreedom)));
}

export function excelTTest(array1Like: unknown, array2Like: unknown) {
  const array1 = finiteNumbers(array1Like);
  const array2 = finiteNumbers(array2Like);
  if (array1.length < 2 || array2.length < 2) {
    throwExcelError(EXCEL_ERROR.div0);
  }
  const meanX = jStat.mean(array1);
  const meanY = jStat.mean(array2);
  const sx = jStat.variance(array1, true);
  const sy = jStat.variance(array2, true);
  const statistic = Math.abs(meanX - meanY) / Math.sqrt(sx / array1.length + sy / array2.length);
  return excelTDist2T(statistic, array1.length + array2.length - 2);
}

export function excelWeibullDist(
  xLike: unknown,
  alphaLike: unknown,
  betaLike: unknown,
  cumulativeLike: unknown,
) {
  const x = parseExcelNumber(xLike);
  const alpha = parseExcelNumber(alphaLike);
  const beta = parseExcelNumber(betaLike);
  const cumulative = parseExcelBool(cumulativeLike);
  if (x < 0 || alpha <= 0 || beta <= 0) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(
    cumulative ? jStat.weibull.cdf(x, alpha, beta) : jStat.weibull.pdf(x, alpha, beta),
  );
}

export function excelZTest(
  arrayLike: unknown,
  xLike: unknown,
  sigmaLike?: unknown,
) {
  const array = finiteNumbers(flattenExcelArgs(arrayLike));
  if (array.length === 0) {
    throwExcelError(EXCEL_ERROR.na);
  }
  const x = parseExcelNumber(xLike);
  const sigma = sigmaLike === undefined
    ? Math.sqrt(jStat.variance(array, true))
    : parseExcelNumber(sigmaLike);
  if (sigma <= 0) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return checkedNumber(1 - jStat.normal.cdf((jStat.mean(array) - x) / (sigma / Math.sqrt(array.length)), 0, 1));
}
