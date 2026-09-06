// eslint-disable-next-line no-control-regex
const DANGEROUS_FORMULA_PREFIX = /^[\s\u0000-\u001f]*[=+\-@]/;

export const sanitizeSpreadsheetText = (value: string): string =>
  DANGEROUS_FORMULA_PREFIX.test(value) ? `'${value}` : value;
