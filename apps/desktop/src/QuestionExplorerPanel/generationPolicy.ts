export type GenerationBlockReason = "final_count_below_source" | "no_additions" | null;

type GenerationPolicyInput = {
  sourceCount: number;
  finalCount: number | null;
  targetCount: number;
};

export const generationBlockReason = ({
  sourceCount,
  finalCount,
  targetCount,
}: GenerationPolicyInput): GenerationBlockReason => {
  if (finalCount === null || finalCount < sourceCount) return "final_count_below_source";
  if (targetCount === 0 && finalCount === sourceCount) return "no_additions";
  return null;
};
