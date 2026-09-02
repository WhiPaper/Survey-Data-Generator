import type {
  AnswerSlot,
  FormSnapshot,
  NormalizedResponse,
  Question,
  QuestionId,
} from "@survey-synth/domain";
import { inferShortTextSemantic } from "./profiler.js";

export type RelationshipFamily =
  | "categorical_categorical"
  | "ordinal_ordinal"
  | "numeric_numeric"
  | "ordinal_numeric"
  | "categorical_numeric"
  | "categorical_ordinal"
  | "ordinal_categorical"
  | "checkbox_option_option";
export interface RelationshipProfile {
  readonly questionA: QuestionId;
  readonly questionB: QuestionId;
  readonly family: RelationshipFamily;
  readonly method: string;
  readonly supportCount: number;
  readonly strength: number;
  readonly signedStrength?: number;
  readonly reliability: number;
  readonly selectionScore: number;
  readonly preserveRecommended: boolean;
  readonly preservationFeatures: readonly string[];
}

type AnalysisRole = "categorical" | "ordinal" | "numeric";

const roleFor = (
  question: Question,
  responses: readonly NormalizedResponse[],
): AnalysisRole | null => {
  if (question.kind === "single_choice") return "categorical";
  if (question.kind === "ordinal") return "ordinal";
  if (question.kind === "date" || question.kind === "time") return "numeric";
  if (question.kind !== "text") return null;
  const inferred = inferShortTextSemantic(question, responses).inferred;
  return inferred === "categorical" ? "categorical" : inferred === "numeric" ? "numeric" : null;
};

const value = (slot: AnswerSlot, role: AnalysisRole): string | number | undefined => {
  if (slot.state !== "answered") return undefined;
  switch (slot.value.kind) {
    case "single_choice":
      return slot.value.optionKey;
    case "ordinal":
      return slot.value.value;
    case "text":
      if (role === "categorical") return slot.value.value;
      if (role === "numeric" && slot.value.value.trim() !== "") {
        const parsed = Number(slot.value.value.trim());
        return Number.isFinite(parsed) ? parsed : undefined;
      }
      return undefined;
    case "date": {
      const parsed = Date.parse(slot.value.value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    case "time": {
      const parts = slot.value.value.split(":").map(Number);
      return parts.every(Number.isFinite)
        ? (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0)
        : undefined;
    }
    default:
      return undefined;
  }
};
const rank = (values: readonly number[]): number[] => {
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    const first = sorted.indexOf(v);
    const last = sorted.lastIndexOf(v);
    return (first + last + 2) / 2;
  });
};
const corr = (a: readonly number[], b: readonly number[]): number => {
  if (a.length < 2) return 0;
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  const ab = a.reduce((s, x, i) => s + (x - ma) * ((b[i] ?? mb) - mb), 0);
  const da = Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0));
  const db = Math.sqrt(b.reduce((s, x) => s + (x - mb) ** 2, 0));
  return da && db ? ab / (da * db) : 0;
};
const cramersV = (a: readonly string[], b: readonly string[]): number => {
  const rows = [...new Set(a)];
  const cols = [...new Set(b)];
  if (rows.length < 2 || cols.length < 2) return 0;
  const cells = rows.map(() => cols.map(() => 0));
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === undefined || bv === undefined) continue;
    const row = cells[rows.indexOf(av)];
    const column = row?.[cols.indexOf(bv)];
    if (row !== undefined && column !== undefined) row[cols.indexOf(bv)] = column + 1;
  }
  const rowTotals = cells.map((r) => r.reduce((x, y) => x + y, 0));
  const colTotals = cols.map((_, j) => cells.reduce((s, r) => s + (r[j] ?? 0), 0));
  let chi = 0;
  for (let i = 0; i < rows.length; i++)
    for (let j = 0; j < cols.length; j++) {
      const expected = ((rowTotals[i] ?? 0) * (colTotals[j] ?? 0)) / a.length;
      const observed = cells[i]?.[j] ?? 0;
      if (expected) chi += (observed - expected) ** 2 / expected;
    }
  return Math.sqrt(
    Math.max(0, chi / (a.length * Math.max(1, Math.min(rows.length - 1, cols.length - 1)))),
  );
};
const reliability = (support: number, total: number, indeterminate: number): number =>
  Math.min(1, support / Math.max(1, total)) * Math.max(0, 1 - indeterminate / Math.max(1, total));

export const analyzeRelationships = (
  form: FormSnapshot,
  responses: readonly NormalizedResponse[],
  maxPairs = 100,
): RelationshipProfile[] => {
  const eligible = form.questions.filter((q) => roleFor(q, responses) !== null);
  const output: RelationshipProfile[] = [];
  const addCheckboxRelationships = (
    question: Extract<Question, { kind: "multi_choice" }>,
  ): void => {
    const options = question.options.slice(0, 20);
    for (let i = 0; i < options.length && output.length < maxPairs; i++) {
      for (let j = i + 1; j < options.length && output.length < maxPairs; j++) {
        const left = options[i];
        const right = options[j];
        if (left === undefined || right === undefined) continue;
        let both = 0;
        let leftCount = 0;
        let rightCount = 0;
        let support = 0;
        for (const response of responses) {
          const slot = response.answers[question.id] ?? { state: "indeterminate" };
          if (slot.state !== "answered" || slot.value.kind !== "multi_choice") continue;
          support++;
          const hasLeft = slot.value.optionKeys.includes(left.key);
          const hasRight = slot.value.optionKeys.includes(right.key);
          if (hasLeft) leftCount++;
          if (hasRight) rightCount++;
          if (hasLeft && hasRight) both++;
        }
        if (support < 3) continue;
        const n = support;
        const phiDenominator = Math.sqrt(
          leftCount * (n - leftCount) * rightCount * (n - rightCount),
        );
        const phi = phiDenominator === 0 ? 0 : (both * n - leftCount * rightCount) / phiDenominator;
        const rel = reliability(support, responses.length, responses.length - support);
        output.push({
          questionA: question.id,
          questionB: question.id,
          family: "checkbox_option_option",
          method: "phi_joint",
          supportCount: support,
          strength: Math.abs(phi),
          signedStrength: phi,
          reliability: rel,
          selectionScore: Math.abs(phi) * rel,
          preserveRecommended: support >= 10 && Math.abs(phi) * rel >= 0.2,
          preservationFeatures: [
            `cooccurrence:${left.key}:${right.key}`,
            "selection_count_distribution",
          ],
        });
      }
    }
  };
  for (const question of form.questions)
    if (question.kind === "multi_choice") addCheckboxRelationships(question);
  for (let i = 0; i < eligible.length && output.length < maxPairs; i++)
    for (let j = i + 1; j < eligible.length && output.length < maxPairs; j++) {
      const a = eligible[i];
      const b = eligible[j];
      if (a === undefined || b === undefined) continue;
      const av: (string | number)[] = [];
      const bv: (string | number)[] = [];
      let indeterminate = 0;
      for (const r of responses) {
        const sa = r.answers[a.id] ?? { state: "indeterminate" };
        const sb = r.answers[b.id] ?? { state: "indeterminate" };
        if (sa.state === "indeterminate" || sb.state === "indeterminate") indeterminate++;
        const roleA = roleFor(a, responses);
        const roleB = roleFor(b, responses);
        const va = roleA === null ? undefined : value(sa, roleA);
        const vb = roleB === null ? undefined : value(sb, roleB);
        if (va !== undefined && vb !== undefined) {
          av.push(va);
          bv.push(vb);
        }
      }
      if (av.length < 3) continue;
      const roleA = roleFor(a, responses);
      const roleB = roleFor(b, responses);
      if (roleA === null || roleB === null) continue;
      const an = roleA !== "categorical";
      const bn = roleB !== "categorical";
      let family: RelationshipFamily;
      let method: string;
      let signedStrength: number | undefined;
      let strength: number;
      let features: string[];
      if (an && bn) {
        family =
          roleA === "ordinal" && roleB === "ordinal"
            ? "ordinal_ordinal"
            : roleA === "ordinal" || roleB === "ordinal"
              ? "ordinal_numeric"
              : "numeric_numeric";
        method = "pearson_spearman";
        const pearson = corr(av as number[], bv as number[]);
        const spearman = corr(rank(av as number[]), rank(bv as number[]));
        signedStrength = Math.abs(pearson) >= Math.abs(spearman) ? pearson : spearman;
        strength = Math.abs(signedStrength);
        features =
          family === "ordinal_ordinal"
            ? ["rank_product"]
            : ["standardized_product", "rank_product"];
      } else if (!an && !bn) {
        family = "categorical_categorical";
        method = "cramers_v";
        strength = cramersV(av.map(String), bv.map(String));
        features = ["joint_cells"];
      } else {
        const categoricalA = roleA === "categorical";
        const categoricalB = roleB === "categorical";
        family = categoricalA
          ? roleB === "ordinal"
            ? "categorical_ordinal"
            : "categorical_numeric"
          : categoricalB
            ? roleA === "ordinal"
              ? "ordinal_categorical"
              : "categorical_numeric"
            : "ordinal_numeric";
        method = family === "categorical_numeric" ? "eta" : "rank_eta";
        const cats = (an ? bv : av).map(String);
        const nums = (an ? av : bv) as number[];
        const mean = nums.reduce((x, y) => x + y, 0) / nums.length;
        const groups = [...new Set(cats)];
        const between = groups.reduce((s, g) => {
          const xs = nums.filter((_, k) => cats[k] === g);
          const m = xs.reduce((x, y) => x + y, 0) / xs.length;
          return s + xs.length * (m - mean) ** 2;
        }, 0);
        const total = nums.reduce((s, x) => s + (x - mean) ** 2, 0);
        strength = total ? Math.sqrt(between / total) : 0;
        features = ["category_numeric_group_means"];
      }
      const rel = reliability(av.length, responses.length, indeterminate);
      const selectionScore = strength * rel;
      output.push({
        questionA: a.id,
        questionB: b.id,
        family,
        method,
        supportCount: av.length,
        strength,
        ...(signedStrength === undefined ? {} : { signedStrength }),
        reliability: rel,
        selectionScore,
        preserveRecommended: selectionScore >= 0.2 && av.length >= 10,
        preservationFeatures: features,
      });
    }
  return output.sort((x, y) => y.selectionScore - x.selectionScore);
};
