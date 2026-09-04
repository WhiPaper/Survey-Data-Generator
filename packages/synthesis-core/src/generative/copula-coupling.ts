/**
 * Gaussian Copula and latent persona coupling for preserving realistic
 * correlations across ordinal satisfaction questions, Likert scales, and grids.
 */

/** Standard normal CDF approximation (Abramowitz & Stegun). */
export const normalCdf = (x: number): number => {
  const b1 = 0.31938153;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;
  const c = 0.39894228;

  if (x >= 0.0) {
    const t = 1.0 / (1.0 + p * x);
    return 1.0 - c * Math.exp((-x * x) / 2.0) * t * (t * (t * (t * (t * b5 + b4) + b3) + b2) + b1);
  }
  const t = 1.0 / (1.0 - p * x);
  return c * Math.exp((-x * x) / 2.0) * t * (t * (t * (t * (t * b5 + b4) + b3) + b2) + b1);
};

/** Approximate inverse standard normal CDF (rational approximation). */
export const inverseNormalCdf = (p: number): number => {
  if (p <= 0.0) return -6.0;
  if (p >= 1.0) return 6.0;

  // Coefficients in rational approximations
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pLow = 0.02425;
  const pHigh = 1.0 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2.0 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1.0);
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1.0);
  }
  const q = Math.sqrt(-2.0 * Math.log(1.0 - p));
  return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1.0);
};

export class LatentPersona {
  /** Overall satisfaction/enthusiasm trait: N(0, 1) */
  public readonly satisfactionTrait: number;
  /** Activity/spending propensity trait: N(0, 1) */
  public readonly propensityTrait: number;

  public constructor(random: () => number) {
    // Box-Muller transform for 2 independent N(0, 1) draws
    const u1 = Math.max(1e-7, Math.min(1 - 1e-7, random()));
    const u2 = Math.max(1e-7, Math.min(1 - 1e-7, random()));
    const r = Math.sqrt(-2.0 * Math.log(u1));
    const theta = 2.0 * Math.PI * u2;
    this.satisfactionTrait = r * Math.cos(theta);
    this.propensityTrait = r * Math.sin(theta);
  }

  /**
   * Adjusts a uniform draw [0, 1] for an ordinal satisfaction question
   * to correlate with the respondent's latent satisfaction trait.
   */
  public coupledQuantile(baseUniform: number, couplingWeight = 0.55): number {
    const boundedU = Math.max(1e-5, Math.min(1 - 1e-5, baseUniform));
    const z = inverseNormalCdf(boundedU);
    const coupledZ = Math.sqrt(1 - couplingWeight * couplingWeight) * z + couplingWeight * this.satisfactionTrait;
    return normalCdf(coupledZ);
  }
}

