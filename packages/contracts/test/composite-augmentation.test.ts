import { describe, expect, it } from "vitest";

import { AugmentationBatchDraftSchema, SynthesisStartParamsSchema } from "../src/protocol";

describe("composite augmentation contracts", () => {
  it("allows a targetless positive add rule and targetless direct synthesis", () => {
    expect(
      SynthesisStartParamsSchema.parse({ projectId: "p", finalCount: 12, targets: [], seed: 1 }),
    ).toMatchObject({ targets: [] });
    expect(
      AugmentationBatchDraftSchema.parse({
        projectId: "p",
        overlapPolicy: "reject",
        rules: [
          {
            ruleId: "august",
            sourceScope: { kind: "all" },
            count: { kind: "add", value: 40 },
            targets: [],
            seed: 1,
          },
        ],
      }).rules[0]?.count,
    ).toEqual({ kind: "add", value: 40 });
  });

  it("keeps rule and target identity local to the rule", () => {
    const result = AugmentationBatchDraftSchema.safeParse({
      projectId: "p",
      overlapPolicy: "reject",
      rules: [
        {
          ruleId: "same",
          sourceScope: { kind: "all" },
          count: { kind: "add", value: 1 },
          targets: [],
          seed: 1,
        },
        {
          ruleId: "same",
          sourceScope: { kind: "all" },
          count: { kind: "add", value: 1 },
          targets: [],
          seed: 2,
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
