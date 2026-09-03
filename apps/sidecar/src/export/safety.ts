// eslint-disable-next-line no-control-regex
const DANGEROUS_FORMULA_PREFIX = /^[\s\u0000-\u001f]*[=+\-@]/;

export const isFormulaDangerous = (value: string): boolean => {
  return DANGEROUS_FORMULA_PREFIX.test(value);
};

export const sanitizeFormulaInjection = (value: string): string => {
  if (isFormulaDangerous(value)) {
    return `'${value}`;
  }
  return value;
};

const WINDOWS_RESERVED_BASENAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu;
const MAX_SUGGESTED_FILENAME_LENGTH = 120;

export const sanitizeFilename = (name: string, fallback = "survey-responses"): string => {
  /* eslint-disable no-control-regex */
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    /* eslint-enable no-control-regex */
    .replace(/\s+/g, " ")
    .trim();
  const withoutTrailingDots = cleaned.replace(/[. ]+$/u, "");
  const shortened = [...withoutTrailingDots].slice(0, MAX_SUGGESTED_FILENAME_LENGTH).join("");
  const usable = shortened.replace(/[. ]+$/u, "");
  if (usable.length === 0) return fallback;
  return WINDOWS_RESERVED_BASENAME.test(usable) ? `_${usable}` : usable;
};
