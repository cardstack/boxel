import type { CoverageCase } from './case.ts';

export const formulaStatisticalCases: CoverageCase[] = [
  // Beta(2, 1) has density 2x, CDF x^2 and quantile sqrt(p) on the unit
  // interval. Beta(1, 2) is its mirror image, so these values also pin alpha
  // and beta to their respective slots. The trailing a and b rescale the
  // support onto [a, b], and each is chosen so x maps back to the same 0.5.
  {
    covers: 'BETA_DIST/4',
    source: 'BETA_DIST(0.25, 2, 1, false)',
    expected: 0.5,
    tolerance: 1e-12,
  },
  {
    covers: 'BETA_DIST/5',
    source: 'BETA_DIST(0.625, 2, 1, true, 0.25)',
    expected: 0.25,
    tolerance: 1e-12,
  },
  {
    covers: 'BETA_DIST/6',
    source: 'BETA_DIST(3, 2, 1, true, 1, 5)',
    expected: 0.25,
    tolerance: 1e-12,
  },
  {
    covers: 'BETA_INV/3',
    source: 'BETA_INV(0.25, 2, 1)',
    expected: 0.5,
    tolerance: 1e-9,
  },
  {
    covers: 'BETA_INV/4',
    source: 'BETA_INV(0.25, 2, 1, 0.5)',
    expected: 0.75,
    tolerance: 1e-9,
  },
  {
    covers: 'BETA_INV/5',
    source: 'BETA_INV(0.25, 2, 1, 2, 6)',
    expected: 4,
    tolerance: 1e-9,
  },
  {
    covers: 'BINOM_DIST/4',
    // p away from 0.5, so p and 1-p are not interchangeable and a
    // success/failure swap is visible: C(3,1)*0.25*0.75^2.
    source: 'BINOM_DIST(1, 3, 0.25, false)',
    expected: 0.421875,
    tolerance: 1e-12,
  },
  // C(4,2)/2^4 = 6/16; adding the upper bound sums P(2..4) = 11/16.
  {
    covers: 'BINOM_DIST_RANGE/3',
    source: 'BINOM_DIST_RANGE(4, 0.5, 2)',
    expected: 0.375,
    tolerance: 1e-12,
  },
  {
    covers: 'BINOM_DIST_RANGE/4',
    source: 'BINOM_DIST_RANGE(4, 0.5, 2, 4)',
    expected: 0.6875,
    tolerance: 1e-12,
  },
  // Smallest k with CDF(k) >= alpha: CDF(1) = 5/16 < 0.5 <= CDF(2) = 11/16.
  { covers: 'BINOM_INV/3', source: 'BINOM_INV(4, 0.5, 0.5)', expected: 2 },
  // Chi-square with 2 degrees of freedom is exponential with mean 2:
  // CDF(x) = 1 - exp(-x/2), quantile -2*ln(1 - p).
  {
    covers: 'CHISQ_DIST/3',
    source: 'CHISQ_DIST(2, 2, true)',
    expected: 0.6321205588285577,
    tolerance: 1e-9,
  },
  {
    covers: 'CHISQ_DIST_RT/2',
    source: 'CHISQ_DIST_RT(2, 2)',
    expected: 0.36787944117144233,
    tolerance: 1e-9,
  },
  {
    covers: 'CHISQ_INV/2',
    source: 'CHISQ_INV(0.5, 2)',
    expected: 1.3862943611198906,
    tolerance: 1e-9,
  },
  {
    covers: 'CHISQ_INV_RT/2',
    source: 'CHISQ_INV_RT(0.05, 2)',
    expected: 5.991464547107982,
    tolerance: 1e-7,
  },
  // Flat arrays are a single column, so df = rows - 1 = 1. Cells are chosen
  // to make the statistic exactly 1: 2^2/8 + 1^2/2. The chi-square(1) upper
  // tail at 1 is the two-sided standard-normal tail at 1, 2*(1 - CDF(1)).
  {
    covers: 'CHISQ_TEST/2',
    source: 'CHISQ_TEST([10, 1], [8, 2])',
    expected: 0.3173105078629141,
    tolerance: 1e-9,
  },
  // z_{0.975} * sd/sqrt(n) = 1.959963984540054 * 2/4.
  {
    covers: 'CONFIDENCE_NORM/3',
    source: 'CONFIDENCE_NORM(0.05, 2, 16)',
    expected: 0.979981992270027,
    tolerance: 1e-8,
  },
  {
    covers: 'CONFIDENCE_T/3',
    // T.INV.2T(0.05, 4) / sqrt(5), where the two-tailed t quantile is
    // 2.7764451051977944 — solved in closed form, since for four degrees of
    // freedom the Student-t CDF integrates to 1/2 + (3/4)(s - s^3/3) with
    // s = t/sqrt(t^2 + 4). The normal quantile in its place would answer
    // 0.877, three and a half million tolerances away, so the tolerance is
    // set by the ~1e-8 accuracy of the underlying t inverse rather than by
    // anything this case needs to tell apart.
    source: 'CONFIDENCE_T(0.05, 1, 5)',
    expected: 1.2416639982037645,
    tolerance: 1e-7,
  },
  // Density lambda*exp(-lambda*x) = 2/e^2.
  {
    covers: 'EXPON_DIST/3',
    source: 'EXPON_DIST(1, 2, false)',
    expected: 0.2706705664732254,
    tolerance: 1e-9,
  },
  // F(1, d2) is the square of a t variate on d2 degrees of freedom, and at
  // d2 = 2 that collapses to the closed forms CDF(x) = sqrt(x/(x + 2)) and
  // quantile(p) = 2p^2/(1 - p^2). The two degrees of freedom differ, so these
  // also pin which argument is the numerator's.
  {
    covers: 'F_DIST/4',
    source: 'F_DIST(2, 1, 2, true)',
    expected: 0.7071067811865476,
    tolerance: 1e-7,
  },
  {
    covers: 'F_DIST_RT/3',
    source: 'F_DIST_RT(2, 1, 2)',
    expected: 0.2928932188134524,
    tolerance: 1e-7,
  },
  {
    covers: 'F_INV/3',
    source: 'F_INV(0.5, 1, 2)',
    expected: 2 / 3,
    tolerance: 1e-9,
  },
  {
    covers: 'F_INV_RT/3',
    source: 'F_INV_RT(0.25, 1, 2)',
    expected: 2.5714285714285716,
    tolerance: 1e-6,
  },
  // Two-tailed variance-ratio test. Sample variances 2 and 8 with df (1,1)
  // give p = 2*(1 - F_CDF(4; 1, 1)) = (4/pi)*atan(1/2) by the Cauchy-square
  // identity.
  {
    covers: 'F_TEST/2',
    source: 'F_TEST([0, 2], [0, 4])',
    expected: 0.5903344706017098,
    tolerance: 1e-9,
  },
  // The gamma function itself, not the distribution: Gamma(5) = 4!.
  { covers: 'GAMMA/1', source: 'GAMMA(5)', expected: 24, tolerance: 1e-9 },
  {
    covers: 'GAMMALN/1',
    // ln Gamma(1/2) = ln sqrt(pi). Gamma(1) is 1 and its log 0, which a
    // stub returning zero also satisfies.
    source: 'GAMMALN(0.5)',
    expected: 0.5723649429247001,
    tolerance: 1e-12,
  },
  // ln(Gamma(6)) = ln(120).
  {
    covers: 'GAMMALN_PRECISE/1',
    source: 'GAMMALN_PRECISE(6)',
    expected: 4.787491742782046,
    tolerance: 1e-9,
  },
  // Gamma with alpha = 1 is exponential with beta as its mean, so the CDF at
  // x = beta is 1 - 1/e and the median is beta*ln(2). Swapping alpha and beta
  // would move both, pinning the shape to the first slot.
  {
    covers: 'GAMMA_DIST/4',
    source: 'GAMMA_DIST(2, 1, 2, true)',
    expected: 0.6321205588285577,
    tolerance: 1e-9,
  },
  {
    covers: 'GAMMA_INV/3',
    source: 'GAMMA_INV(0.5, 1, 2)',
    expected: 1.3862943611198906,
    tolerance: 1e-8,
  },
  // Standard-normal CDF above 1/2: CDF(1) - 1/2 = 0.8413447... - 0.5.
  {
    covers: 'GAUSS/1',
    source: 'GAUSS(1)',
    expected: 0.3413447460685429,
    tolerance: 1e-9,
  },
  // C(4,1)*C(6,1)/C(10,2) = 24/45.
  {
    covers: 'HYPGEOM_DIST/5',
    // The sample size and the population's success count are interchangeable
    // here, and not by accident: C(K,k)C(N-K,n-k)/C(N,n) is symmetric in n
    // and K, so no case can separate them and transposing them in the bridge
    // would change no answer.
    source: 'HYPGEOM_DIST(1, 2, 4, 10, false)',
    expected: 0.5333333333333333,
    tolerance: 1e-9,
  },
  // At x = e with mu = 0, sigma = 1, ln(x) standardizes to 1, so the CDF is
  // the standard-normal CDF at 1; the median is exp(mu).
  {
    covers: 'LOGNORM_DIST/4',
    source: 'LOGNORM_DIST(2.718281828459045, 0, 1, true)',
    expected: 0.8413447460685429,
    tolerance: 1e-8,
  },
  {
    covers: 'LOGNORM_INV/3',
    // Off the median: at p = 0.5 the answer is exp(mu) whatever sigma is.
    source: 'LOGNORM_INV(0.9, 1, 2)',
    expected: 35.27248263126183,
    tolerance: 1e-8,
  },
  // P(1 failure before the 2nd success) = C(2,1)*(1/2)^2*(1/2) = 1/4.
  {
    covers: 'NEGBINOM_DIST/4',
    source: 'NEGBINOM_DIST(1, 2, 0.5, false)',
    expected: 0.25,
    tolerance: 1e-12,
  },
  // (42 - 40)/2 standardizes to 1, so this is the normal CDF at 1.
  {
    covers: 'NORM_DIST/4',
    source: 'NORM_DIST(42, 40, 2, true)',
    expected: 0.8413447460685429,
    tolerance: 1e-8,
  },
  // Location-scale: mu + sigma*z, with 1.959963984540054 the published
  // two-sided 95% standard-normal quantile.
  {
    covers: 'NORM_INV/3',
    source: 'NORM_INV(0.975, 100, 10)',
    expected: 100 + 10 * 1.959963984540054,
    tolerance: 1e-6,
  },
  {
    covers: 'NORM_S_DIST/2',
    source: 'NORM_S_DIST(0, true)',
    expected: 0.5,
    tolerance: 1e-12,
  },
  {
    covers: 'NORM_S_INV/1',
    source: 'NORM_S_INV(0.975)',
    expected: 1.959963984540054,
    tolerance: 1e-8,
  },
  // Standard-normal density at 0 is 1/sqrt(2*pi).
  {
    covers: 'PHI/1',
    source: 'PHI(0)',
    expected: 0.3989422804014327,
    tolerance: 1e-12,
  },
  // P(X <= 1) with mean 1 is (1 + 1)*exp(-1) = 2/e.
  {
    covers: 'POISSON_DIST/3',
    source: 'POISSON_DIST(1, 1, true)',
    expected: 0.7357588823428847,
    tolerance: 1e-9,
  },
  {
    covers: 'STANDARDIZE/3',
    source: 'STANDARDIZE(42, 40, 8)',
    expected: 0.25,
  },
  // With 1 degree of freedom the t distribution is Cauchy: CDF(x) is
  // 1/2 + atan(x)/pi and the quantile is tan(pi*(p - 1/2)), so at x = 1 the
  // CDF, two-tailed, and right-tailed forms are exactly 3/4, 1/2, and 1/4,
  // with T_INV and T_INV_2T inverting them back to 1.
  {
    covers: 'T_DIST/3',
    source: 'T_DIST(1, 1, true)',
    expected: 0.75,
    tolerance: 1e-8,
  },
  {
    covers: 'T_DIST_2T/2',
    source: 'T_DIST_2T(1, 1)',
    expected: 0.5,
    tolerance: 1e-8,
  },
  {
    covers: 'T_DIST_RT/2',
    source: 'T_DIST_RT(1, 1)',
    expected: 0.25,
    tolerance: 1e-8,
  },
  {
    covers: 'T_INV/2',
    source: 'T_INV(0.75, 1)',
    expected: 1,
    tolerance: 1e-6,
  },
  {
    covers: 'T_INV_2T/2',
    source: 'T_INV_2T(0.5, 1)',
    expected: 1,
    tolerance: 1e-6,
  },
  // Two-sample two-tailed t-test with df = n1 + n2 - 2. Means 1 and 4 with
  // sample variances both 2 give t = 3/sqrt(2) on 2 degrees of freedom, and
  // the df=2 CDF 1/2 + t/(2*sqrt(t^2 + 2)) reduces p to 1 - 3/sqrt(13).
  {
    covers: 'T_TEST/2',
    source: 'T_TEST([0, 2], [3, 5])',
    expected: 0.16794970566215628,
    tolerance: 1e-9,
  },
  // Unequal sizes and unequal variances, which is where the choice of test
  // shows: this is Excel's T.TEST(...; 2; 3), the two-tailed unequal-variance
  // form, whose degrees of freedom are Welch–Satterthwaite's 2.05 rather than
  // the pooled 5. Pooling them would give 0.0159 instead.
  {
    covers: 'T_TEST/2',
    source: 'T_TEST([1, 2, 3, 4], [10, 20, 30])',
    expected: 0.0919893089522017,
    tolerance: 1e-9,
  },
  // Excel's WEIBULL.DIST(x, alpha, beta, ...) takes alpha as the shape and
  // beta as the scale: CDF = 1 - exp(-(x/beta)^alpha), so 1 - exp(-4) here.
  // Transposing the two would give 1 - exp(-1) instead.
  {
    covers: 'WEIBULL_DIST/4',
    source: 'WEIBULL_DIST(2, 2, 1, true)',
    expected: 0.9816843611112658,
    tolerance: 1e-9,
  },
  // The density needs its own case with shape and scale far apart: at 2 and 1
  // the cumulative form alone would pass with the two transposed. Microsoft
  // documents WEIBULL.DIST(105, 20, 100, FALSE) as 0.035589.
  {
    covers: 'WEIBULL_DIST/4',
    source: 'WEIBULL_DIST(105, 20, 100, false)',
    expected: 0.03558886402450434,
    tolerance: 1e-12,
  },
  // One-tailed upper-tail test against the hypothesized mean. The
  // three-argument form takes the population sigma instead of estimating it,
  // so sigma = 2 over n = 4 with a mean one unit above x makes z = 1.
  {
    covers: 'Z_TEST/2',
    // A hypothesized mean away from the sample mean: at x = 3 the statistic
    // is exactly 0 and the answer is 0.5 whatever the spread, so the sample
    // itself would be inert.
    source: 'Z_TEST([1, 2, 3, 4, 5], 2)',
    expected: 0.07864960352514261,
    tolerance: 1e-12,
  },
  {
    covers: 'Z_TEST/3',
    source: 'Z_TEST([1, 2, 3, 4], 1.5, 2)',
    expected: 0.15865525393145707,
    tolerance: 1e-8,
  },
];
