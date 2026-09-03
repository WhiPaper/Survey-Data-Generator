const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;

const PHONE_PATTERN =
  /(?:\b(?:\+?82|0)(?:1[0-9]|2|[3-6][1-5]|70)[-.\s]?\d{3,4}[-.\s]?\d{4}\b)|(?:\b\+?[1-9]\d{0,2}[-.\s]?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b)/g;

const NATIONAL_ID_PATTERN = /\b\d{6}[-\s]?[1-4]\d{6}\b/g;

const CREDIT_CARD_PATTERN = /\b(?:\d{4}[-\s]?){3}\d{4}\b/g;

const PII_PATTERNS = [EMAIL_PATTERN, PHONE_PATTERN, NATIONAL_ID_PATTERN, CREDIT_CARD_PATTERN];

const PII_KEYWORD_PATTERN =
  /(?:\bname\b|full\s*name|first\s*name|last\s*name|email|e-mail|phone|telephone|mobile|cellphone|address|resident|ssn|social\s*security|customer\s*id|client\s*id|user\s*id|account\s*id|\baccount\b|이름|성함|성명|이메일|전화|연락처|휴대폰|핸드폰|주소|거주지|주민등록|주민번호|고객번호|고객\s*id|회원번호|회원\s*id|계좌|계좌번호|카드번호)/i;

export const containsPii = (text: string): boolean => {
  if (!text || text.trim() === "") return false;
  return PII_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
};

export const redactPii = (text: string): string => {
  if (!text) return "";
  let result = text;
  for (const pattern of PII_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
};

export const isPiiRiskQuestion = (title: string, description?: string): boolean => {
  const combined = `${title} ${description ?? ""}`.trim();
  return PII_KEYWORD_PATTERN.test(combined);
};
