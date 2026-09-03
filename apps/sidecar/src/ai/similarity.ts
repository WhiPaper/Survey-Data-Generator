import { AI_GENERATION_POLICY_V1 } from "./policy.js";

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

const findLongestCommonSubstringLength = (a: string, b: string): number => {
  if (a.length === 0 || b.length === 0) return 0;
  const n = a.length;
  const m = b.length;
  let maxLen = 0;
  let prev = new Array<number>(m + 1).fill(0);
  let curr = new Array<number>(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        const val = (prev[j - 1] ?? 0) + 1;
        curr[j] = val;
        if (val > maxLen) maxLen = val;
      } else {
        curr[j] = 0;
      }
    }
    const temp = prev;
    prev = curr;
    curr = temp;
    curr.fill(0);
  }

  return maxLen;
};

const getCharacterBigrams = (text: string): Set<string> => {
  const bigrams = new Set<string>();
  if (text.length < 2) {
    if (text.length > 0) bigrams.add(text);
    return bigrams;
  }
  for (let i = 0; i <= text.length - 2; i++) {
    bigrams.add(text.slice(i, i + 2));
  }
  return bigrams;
};

const bigramJaccardSimilarity = (a: string, b: string): number => {
  const setA = getCharacterBigrams(a);
  const setB = getCharacterBigrams(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

export const isTooSimilar = (
  generatedText: string,
  sourceExamples: readonly string[],
): boolean => {
  const normGen = normalize(generatedText);
  if (normGen.length === 0) return false;

  for (const source of sourceExamples) {
    const normSource = normalize(source);
    if (normSource.length === 0) continue;

    // 1. Normalized exact match check
    if (normGen === normSource) return true;

    // 2. Longest common substring check
    const lcsLen = findLongestCommonSubstringLength(normGen, normSource);
    if (lcsLen >= AI_GENERATION_POLICY_V1.minSubstringMatchChars) return true;

    // 3. N-gram similarity check
    const similarity = bigramJaccardSimilarity(normGen, normSource);
    if (similarity >= AI_GENERATION_POLICY_V1.maxNgramSimilarity) return true;
  }

  return false;
};
