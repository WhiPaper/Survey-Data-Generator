import type { TextClusterGroup } from "@survey-synth/domain";

export type { TextClusterGroup } from "@survey-synth/domain";

const CHO_SEONG = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

const JUNG_SEONG = [
  "ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ",
] as const;

const JONG_SEONG = [
  "", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

/**
 * 한글, 한자(CJK), 영문, 숫자 등 다국어 텍스트를 유니코드 정규화(NFKC)하고,
 * 한글 음절은 자모 단위로 분해하여 오타/변형에 강건한 표준 스트림으로 변환합니다.
 * 한자(CJK)와 영문, 숫자는 온전히 보존됩니다.
 */
export const normalizeUniversalText = (text: string): string => {
  const normalized = text.normalize("NFKC").trim().toLowerCase();
  const result: string[] = [];

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (char === undefined) continue;
    const code = char.charCodeAt(0);

    // 1. 한글 음절 (0xAC00 ~ 0xD7A3): 자모 분해
    if (code >= 0xac00 && code <= 0xd7a3) {
      const syllableIndex = code - 0xac00;
      const jongIndex = syllableIndex % 28;
      const jungIndex = Math.floor((syllableIndex - jongIndex) / 28) % 21;
      const choIndex = Math.floor((syllableIndex - jongIndex) / 28 / 21);

      result.push(CHO_SEONG[choIndex] ?? "");
      result.push(JUNG_SEONG[jungIndex] ?? "");
      const jong = JONG_SEONG[jongIndex];
      if (jong) result.push(jong);
    }
    // 2. 한자(CJK Unified Ideographs: 0x4E00 ~ 0x9FFF 및 호환 한자)
    else if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff)
    ) {
      result.push(char);
    }
    // 3. 영문, 숫자, 한글 자모
    else if (/[a-z0-9ㄱ-ㅎㅏ-ㅣ]/.test(char)) {
      result.push(char);
    }
    // 4. 단어 구분을 위한 공백 보존
    else if (/\s/.test(char)) {
      if (result.length > 0 && result[result.length - 1] !== " ") {
        result.push(" ");
      }
    }
    // 특수문자, 괄호 등은 무시하거나 공백으로 취급
  }

  return result.join("").trim();
};

/**
 * 텍스트에서 문자 단위 N-gram 및 단어 토큰을 추출합니다.
 * 한자(CJK)는 1글자 단위로도 의미를 가지므로 1-gram도 포함합니다.
 */
export const extractUniversalNgrams = (text: string, n = 2): Set<string> => {
  const normalized = normalizeUniversalText(text);
  const ngrams = new Set<string>();

  if (normalized.length === 0) return ngrams;

  // 단어 단위 토큰 분리
  const words = normalized.split(/\s+/).filter((w) => w.length > 0);
  for (const word of words) {
    ngrams.add(`w_${word}`);
  }

  // 공백 제거된 연속 스트림
  const compact = normalized.replace(/\s+/g, "");
  if (compact.length < n) {
    ngrams.add(compact);
  } else {
    for (let i = 0; i <= compact.length - n; i++) {
      ngrams.add(compact.slice(i, i + n));
    }
  }

  // 한자(CJK) 문자는 1-gram도 단독 토큰으로 추가 (표의문자 특성 반영)
  for (const char of compact) {
    const code = char.charCodeAt(0);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff)
    ) {
      ngrams.add(`cjk_${char}`);
    }
  }

  return ngrams;
};

/**
 * 두 N-gram 집합 간의 자카드 유사도(Jaccard Similarity)를 계산합니다.
 */
export const jaccardSimilarity = (setA: ReadonlySet<string>, setB: ReadonlySet<string>): number => {
  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;

  let intersectionCount = 0;
  for (const item of setA) {
    if (setB.has(item)) intersectionCount++;
  }

  const unionCount = setA.size + setB.size - intersectionCount;
  return unionCount === 0 ? 0.0 : intersectionCount / unionCount;
};

/**
 * 두 문자열 간의 레벤슈타인 편집 거리(Levenshtein Distance)를 계산합니다.
 */
export const levenshteinDistance = (a: string, b: string): number => {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    const temp = prev;
    prev = curr;
    curr = temp;
  }
  return prev[n]!;
};

export const editSimilarity = (a: string, b: string): number => {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(a, b);
  return 1.0 - dist / maxLen;
};

/**
 * 다국어(한글, 한자, 영문, 숫자) 간의 복합 형태 유사도를 계산합니다.
 * - 서브스트링 / 접두사 포함 보정 (예: "대구" ↔ "대구광역시", "大邱" ↔ "大邱市", "Google" ↔ "Google LLC")
 * - 레벤슈타인 편집 거리 보정 (오타 및 1~2글자 변형 흡수)
 * - N-gram 자카드 유사도
 */
export const computeUniversalSimilarity = (textA: string, textB: string): number => {
  const cleanA = textA.trim().toLowerCase().replace(/\s+/g, "");
  const cleanB = textB.trim().toLowerCase().replace(/\s+/g, "");

  if (cleanA === cleanB) return 1.0;
  if (cleanA.length === 0 || cleanB.length === 0) return 0.0;

  let maxSimilarity = 0.0;

  // 1. 원본 텍스트 기준 접두사 / 서브스트링 포함 관계 검사
  if (cleanA.startsWith(cleanB) || cleanB.startsWith(cleanA)) {
    const minLen = Math.min(cleanA.length, cleanB.length);
    const maxLen = Math.max(cleanA.length, cleanB.length);
    if (minLen / maxLen >= 0.25) {
      maxSimilarity = Math.max(maxSimilarity, 0.85);
    }
  } else if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) {
    const minLen = Math.min(cleanA.length, cleanB.length);
    const maxLen = Math.max(cleanA.length, cleanB.length);
    if (minLen / maxLen >= 0.3) {
      maxSimilarity = Math.max(maxSimilarity, 0.78);
    }
  }

  // 2. 자모/다국어 정규화 스트림 기준 검사
  const normA = normalizeUniversalText(textA).replace(/\s+/g, "");
  const normB = normalizeUniversalText(textB).replace(/\s+/g, "");

  if (normA.startsWith(normB) || normB.startsWith(normA)) {
    const minLen = Math.min(normA.length, normB.length);
    const maxLen = Math.max(normA.length, normB.length);
    if (minLen / maxLen >= 0.25) {
      maxSimilarity = Math.max(maxSimilarity, 0.85);
    }
  } else if (normA.includes(normB) || normB.includes(normA)) {
    const minLen = Math.min(normA.length, normB.length);
    const maxLen = Math.max(normA.length, normB.length);
    if (minLen / maxLen >= 0.3) {
      maxSimilarity = Math.max(maxSimilarity, 0.78);
    }
  }

  // 3. 편집 거리(Levenshtein) 유사도
  const charEditSim = editSimilarity(cleanA, cleanB);
  maxSimilarity = Math.max(maxSimilarity, charEditSim);

  // 4. 자모 N-gram 기반 유사도
  const ngramsA = extractUniversalNgrams(textA, 2);
  const ngramsB = extractUniversalNgrams(textB, 2);
  const jaccard = jaccardSimilarity(ngramsA, ngramsB);
  maxSimilarity = Math.max(maxSimilarity, jaccard);

  return maxSimilarity;
};

export interface TextClusterOptions {
  readonly threshold?: number;
  readonly maxClusters?: number;
}

/**
 * 비정형 단답형 텍스트 응답(한글, 영문, 한자, 숫자 등)을
 * 사전이나 LLM 없이 초경량 군집화(Union-Find)하여 의미 그룹으로 묶습니다.
 */
export const clusterTextResponses = (
  texts: readonly string[],
  options: TextClusterOptions = {},
): TextClusterGroup[] => {
  const threshold = options.threshold ?? 0.65;
  const maxClusters = options.maxClusters ?? 50;

  // 1. 빈도 및 공백 제거 집계
  const frequencyMap = new Map<string, number>();
  for (const raw of texts) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    frequencyMap.set(trimmed, (frequencyMap.get(trimmed) ?? 0) + 1);
  }

  const uniqueTexts = Array.from(frequencyMap.keys());
  const n = uniqueTexts.length;
  if (n === 0) return [];

  // 2. Union-Find Disjoint Set
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (root !== parent[root]) {
      root = parent[root]!;
    }
    let curr = i;
    while (curr !== root) {
      const nxt = parent[curr]!;
      parent[curr] = root;
      curr = nxt;
    }
    return root;
  };
  const union = (i: number, j: number): void => {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) {
      parent[rootI] = rootJ;
    }
  };

  // 3. 다국어 복합 유사도 기반 클러스터 병합 (O(N^2))
  for (let i = 0; i < n; i++) {
    const textI = uniqueTexts[i]!;
    for (let j = i + 1; j < n; j++) {
      const textJ = uniqueTexts[j]!;
      const sim = computeUniversalSimilarity(textI, textJ);
      if (sim >= threshold) {
        union(i, j);
      }
    }
  }

  // 4. 그룹별 항목 취합
  const groupsByRoot = new Map<number, { texts: string[]; totalCount: number }>();
  let totalValidResponses = 0;

  for (let i = 0; i < n; i++) {
    const root = find(i);
    const text = uniqueTexts[i]!;
    const count = frequencyMap.get(text) ?? 0;
    totalValidResponses += count;

    let group = groupsByRoot.get(root);
    if (!group) {
      group = { texts: [], totalCount: 0 };
      groupsByRoot.set(root, group);
    }
    group.texts.push(text);
    group.totalCount += count;
  }

  // 5. 그룹 메타데이터 생성 (최빈값 단어를 대표 라벨로 선택)
  const clusters: TextClusterGroup[] = [];
  let clusterSeq = 0;

  for (const group of groupsByRoot.values()) {
    group.texts.sort((a, b) => (frequencyMap.get(b) ?? 0) - (frequencyMap.get(a) ?? 0));
    const representative = group.texts[0] ?? "";

    clusterSeq++;
    clusters.push({
      id: `tc_${clusterSeq}`,
      label: representative,
      count: group.totalCount,
      share: totalValidResponses > 0 ? group.totalCount / totalValidResponses : 0,
      memberTexts: group.texts,
    });
  }

  // 출현 빈도 내림차순 정렬
  clusters.sort((a, b) => b.count - a.count);

  return clusters.slice(0, maxClusters);
};
