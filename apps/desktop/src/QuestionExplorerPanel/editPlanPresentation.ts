import type { TargetOutcome } from "@survey-synth/contracts";

import { outcomeValue } from "./model";

export const editPlanOutcomeValue = (outcome: TargetOutcome | undefined): string =>
  outcome ? outcomeValue(outcome) : "—";
