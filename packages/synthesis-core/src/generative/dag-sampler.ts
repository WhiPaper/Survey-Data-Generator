import type {
  AnswerSlot,
  FormSnapshot,
  NormalizedResponse,
  OptionKey,
  QuestionId,
  ResponseId,
  SectionId,
} from "@survey-synth/domain";
import { resolveResponsePath } from "@survey-synth/domain";
import type { BayesianFormModel } from "./bayesian-model.js";
import { LatentPersona } from "./copula-coupling.js";
import type { TimestampPair } from "./temporal-sampler.js";

class SeededPrng {
  private state: number;
  public constructor(seed: number) {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }
  public next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
}

export const answerSignature = (answers: Readonly<Record<QuestionId, AnswerSlot>>): string => {
  return Object.entries(answers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([qId, slot]) => {
      if (slot.state !== "answered") return `${qId}:${slot.state}`;
      const v = slot.value;
      switch (v.kind) {
        case "single_choice":
          return `${qId}:${v.optionKey}:${JSON.stringify(v.otherValue ?? null)}`;
        case "multi_choice":
          return `${qId}:${[...v.optionKeys].sort().join(",")}:${JSON.stringify(v.otherValue ?? null)}`;
        case "ordinal":
          return `${qId}:${v.value}`;
        case "text":
          return `${qId}:${v.value.trim()}`;
        case "date":
        case "time":
          return `${qId}:${v.value}`;
        default:
          return `${qId}:other`;
      }
    })
    .join("|");
};

export const perturbSyntheticRow = (
  form: FormSnapshot,
  row: NormalizedResponse,
  seed: number,
  protectedQuestionIds: ReadonlySet<QuestionId> = new Set(),
): NormalizedResponse => {
  const prng = new SeededPrng(seed);
  const random = () => prng.next();

  for (const question of form.questions) {
    if (protectedQuestionIds.has(question.id)) continue;
    if (question.affectsNavigation) continue;

    const currentSlot = row.answers[question.id];
    if (!currentSlot || currentSlot.state !== "answered") continue;

    switch (question.kind) {
      case "ordinal": {
        if (currentSlot.value.kind === "ordinal") {
          if (random() < 0.6) {
            const delta = random() < 0.5 ? 1 : -1;
            const newVal = Math.max(
              question.min,
              Math.min(question.max, currentSlot.value.value + delta),
            );
            (row.answers as Record<QuestionId, AnswerSlot>)[question.id] = {
              state: "answered",
              value: { kind: "ordinal", value: newVal },
            };
          }
        }
        break;
      }
      case "single_choice": {
        if (currentSlot.value.kind === "single_choice" && question.options.length > 1) {
          if (random() < 0.25) {
            const alts = question.options.filter(
              (o) => o.key !== (currentSlot.value as { optionKey: OptionKey }).optionKey,
            );
            if (alts.length > 0) {
              const selected = alts[Math.floor(random() * alts.length)]!;
              (row.answers as Record<QuestionId, AnswerSlot>)[question.id] = {
                state: "answered",
                value: { kind: "single_choice", optionKey: selected.key, label: selected.label },
              };
            }
          }
        }
        break;
      }
      case "multi_choice": {
        if (currentSlot.value.kind === "multi_choice" && question.options.length > 0) {
          if (random() < 0.3) {
            const currentKeys = new Set(currentSlot.value.optionKeys);
            const toggleOpt = question.options[Math.floor(random() * question.options.length)]!;
            if (currentKeys.has(toggleOpt.key)) {
              if (currentKeys.size > (question.required ? 1 : 0)) {
                currentKeys.delete(toggleOpt.key);
              }
            } else {
              currentKeys.add(toggleOpt.key);
            }
            const newKeys = Array.from(currentKeys);
            (row.answers as Record<QuestionId, AnswerSlot>)[question.id] = {
              state: "answered",
              value: {
                kind: "multi_choice",
                optionKeys: newKeys,
                labels: newKeys.map((k) => question.options.find((o) => o.key === k)?.label ?? ""),
                ...(currentSlot.value.otherValue !== undefined && newKeys.some((key) => question.options.some((option) => option.key === key && option.isOther === true))
                  ? { otherValue: currentSlot.value.otherValue }
                  : {}),
              },
            };
          }
        }
        break;
      }
      case "text": {
        if (currentSlot.value.kind === "text") {
          const num = Number(currentSlot.value.value.trim());
          if (Number.isFinite(num) && random() < 0.4) {
            const delta = random() < 0.5 ? 1 : -1;
            (row.answers as Record<QuestionId, AnswerSlot>)[question.id] = {
              state: "answered",
              value: { kind: "text", value: String(Math.max(0, num + delta)) },
            };
          }
        }
        break;
      }
    }
  }

  return row;
};

export const sampleDagResponse = (
  form: FormSnapshot,
  model: BayesianFormModel,
  index: number,
  seed: number,
  temporal: TimestampPair,
  existingSignatures: ReadonlySet<string>,
): { readonly response: NormalizedResponse; readonly signature: string } => {
  let attempt = 0;
  const maxAttempts = 15;

  while (attempt < maxAttempts) {
    const prng = new SeededPrng(seed + index * 7919 + attempt * 104729);
    const random = () => prng.next();
    const persona = new LatentPersona(random);

    const answers: Record<QuestionId, AnswerSlot> = {};
    for (const q of form.questions) {
      answers[q.id] = { state: "not_reached" };
    }

    const transitionsByQuestion = new Map<QuestionId, Map<OptionKey, (typeof form.logic.transitions)[0]>>();
    for (const tr of form.logic.transitions) {
      const map = transitionsByQuestion.get(tr.sourceQuestionId) ?? new Map();
      map.set(tr.optionKey, tr);
      transitionsByQuestion.set(tr.sourceQuestionId, map);
    }

    const effectiveSections =
      form.logic.sections.length > 0
        ? form.logic.sections
        : [
            {
              id: form.logic.entrySectionId ?? ("default_section" as SectionId),
              order: 0,
              questionIds: form.questions.map((q) => q.id),
            },
          ];
    const sectionsById = new Map(effectiveSections.map((s) => [s.id, s]));
    let currentSectionId: SectionId | undefined = effectiveSections[0]!.id;
    const visitedSections = new Set<SectionId>();
    let lastSingleChoiceQuestionId: QuestionId | undefined;
    let lastSingleChoiceOptionKey: OptionKey | undefined;

    while (currentSectionId !== undefined && !visitedSections.has(currentSectionId)) {
      visitedSections.add(currentSectionId);
      const sectionNode = sectionsById.get(currentSectionId);
      if (sectionNode === undefined) break;

      let sectionDestinationOverride: (typeof form.logic.transitions)[0]["destination"] | undefined;

      for (const questionId of sectionNode.questionIds) {
        const question = form.questions.find((q) => q.id === questionId);
        if (question === undefined) continue;

        switch (question.kind) {
          case "single_choice": {
            const dist = model.singleChoice[question.id];
            let options = dist?.options ?? [];
            if (options.length === 0) {
              options = question.options.map((opt) => ({
                key: opt.key,
                label: opt.label,
                probability: 1 / Math.max(1, question.options.length),
              }));
            }

            // Check conditional on previous single-choice parent
            if (lastSingleChoiceQuestionId && lastSingleChoiceOptionKey && dist?.conditional) {
              const condKey = `${lastSingleChoiceQuestionId}:${lastSingleChoiceOptionKey}`;
              const cond = dist.conditional[condKey];
              if (cond && cond.length > 0) {
                options = cond.map((c) => {
                  const orig = question.options.find((o) => o.key === c.key);
                  return {
                    key: c.key,
                    label: orig?.label ?? String(c.key),
                    probability: c.probability,
                  };
                });
              }
            }

            // Sample option
            const totalProb = options.reduce((s, o) => s + o.probability, 0) || 1;
            let draw = random() * totalProb;
            let selected = options[options.length - 1]!;
            for (const opt of options) {
              draw -= opt.probability;
              if (draw <= 0) {
                selected = opt;
                break;
              }
            }

            answers[question.id] = {
              state: "answered",
              value: {
                kind: "single_choice",
                optionKey: selected.key,
                label: selected.label,
              },
            };

            lastSingleChoiceQuestionId = question.id;
            lastSingleChoiceOptionKey = selected.key;

            // Check branch navigation
            const transitions = transitionsByQuestion.get(question.id);
            if (transitions) {
              const transition = transitions.get(selected.key);
              if (transition) {
                sectionDestinationOverride = transition.destination;
              }
            }
            break;
          }

          case "multi_choice": {
            const dist = model.multiChoice[question.id];
            const options = question.options;
            const selCountProbs = dist?.selectionCountProbabilities ?? [];
            
            // Sample selection count
            let selCount = 1;
            if (selCountProbs.length > 0) {
              const totalCountProb = selCountProbs.reduce((s, p) => s + p, 0) || 1;
              let countDraw = random() * totalCountProb;
              for (let c = 0; c < selCountProbs.length; c += 1) {
                countDraw -= selCountProbs[c]!;
                if (countDraw <= 0) {
                  selCount = c;
                  break;
                }
              }
            }
            selCount = Math.min(options.length, Math.max(question.required ? 1 : 0, selCount));

            // Sample distinct options
            const optProbs = dist?.optionProbabilities ?? {};
            const scoredOptions = options.map((opt) => {
              const baseProb = optProbs[opt.key] ?? 0.5;
              // Exponential Gumbel-max trick for weighted sampling without replacement
              const gumbel = -Math.log(-Math.log(Math.max(1e-7, random())));
              return { opt, score: Math.log(Math.max(1e-7, baseProb)) + gumbel };
            });
            scoredOptions.sort((a, b) => b.score - a.score);
            const chosen = scoredOptions.slice(0, selCount).map((item) => item.opt);

            answers[question.id] = {
              state: "answered",
              value: {
                kind: "multi_choice",
                optionKeys: chosen.map((o) => o.key),
                labels: chosen.map((o) => o.label),
              },
            };
            break;
          }

          case "ordinal": {
            const dist = model.ordinal[question.id];
            const min = dist?.min ?? question.min;
            const max = dist?.max ?? question.max;
            const probs = dist?.levelProbabilities ?? [];

            // Draw uniform and couple via latent persona
            const rawU = random();
            const coupledU = persona.coupledQuantile(rawU, 0.55);

            let chosenValue = min;
            if (probs.length > 0) {
              let cumulative = 0;
              for (let i = 0; i < probs.length; i += 1) {
                cumulative += probs[i]!;
                if (coupledU <= cumulative || i === probs.length - 1) {
                  chosenValue = min + i;
                  break;
                }
              }
            } else {
              chosenValue = Math.min(max, Math.max(min, Math.round(min + coupledU * (max - min))));
            }

            answers[question.id] = {
              state: "answered",
              value: { kind: "ordinal", value: chosenValue },
            };
            break;
          }

          case "text": {
            const dist = model.text[question.id];
            const shouldSkip = !question.required && random() < (dist?.emptyRate ?? 0.7);

            if (shouldSkip || !dist || dist.observedValues.length === 0) {
              answers[question.id] = question.required
                ? { state: "answered", value: { kind: "text", value: "없음" } }
                : { state: "skipped" };
            } else {
              const values = dist.observedValues;
              const totalWeight = values.reduce((s, v) => s + v.weight, 0) || 1;
              let draw = random() * totalWeight;
              let selectedText = values[values.length - 1]!.value;
              for (const v of values) {
                draw -= v.weight;
                if (draw <= 0) {
                  selectedText = v.value;
                  break;
                }
              }
              answers[question.id] = {
                state: "answered",
                value: { kind: "text", value: selectedText },
              };
            }
            break;
          }

          case "date": {
            answers[question.id] = {
              state: "answered",
              value: {
                kind: "date",
                value: temporal.createdAt.slice(0, 10),
                includeTime: question.includeTime,
                includeYear: question.includeYear,
              },
            };
            break;
          }

          case "time": {
            answers[question.id] = {
              state: "answered",
              value: {
                kind: "time",
                value: temporal.createdAt.slice(11, 19),
                duration: question.duration,
              },
            };
            break;
          }

          case "file": {
            answers[question.id] = { state: "skipped" };
            break;
          }

          case "unsupported": {
            answers[question.id] = { state: "skipped" };
            break;
          }
        }
      }

      // Route to next section
      if (sectionDestinationOverride) {
        switch (sectionDestinationOverride.type) {
          case "submit":
            currentSectionId = undefined;
            break;
          case "section":
            currentSectionId = sectionDestinationOverride.sectionId;
            break;
          case "next_section":
            currentSectionId = sectionNode.nextSectionId;
            break;
          case "restart":
            currentSectionId = undefined;
            break;
        }
      } else if (sectionNode.nextSectionId) {
        currentSectionId = sectionNode.nextSectionId;
      } else {
        // Find next section in form order
        const currentIdx = form.sections.findIndex((s) => s.id === currentSectionId);
        if (currentIdx >= 0 && currentIdx + 1 < form.sections.length) {
          currentSectionId = form.sections[currentIdx + 1]!.id;
        } else {
          currentSectionId = undefined;
        }
      }
    }

    // Resolve path reachability
    const path = resolveResponsePath(form, answers);
    for (const q of form.questions) {
      if (path.questions[q.id] === "not_reached") {
        answers[q.id] = { state: "not_reached" };
      }
    }

    const sig = answerSignature(answers);
    if (!existingSignatures.has(sig) || attempt === maxAttempts - 1) {
      const response: NormalizedResponse = {
        responseId: `synthetic-${index}` as ResponseId,
        createdAt: temporal.createdAt,
        lastSubmittedAt: temporal.lastSubmittedAt,
        answers,
        origin: "synthetic",
        path,
      };
      return { response, signature: sig };
    }

    attempt += 1;
  }

  // Fallback (guaranteed return)
  const fallbackAnswers: Record<QuestionId, AnswerSlot> = {};
  for (const q of form.questions) {
    fallbackAnswers[q.id] = { state: "not_reached" };
  }
  const path = resolveResponsePath(form, fallbackAnswers);
  const response: NormalizedResponse = {
    responseId: `synthetic-${index}` as ResponseId,
    createdAt: temporal.createdAt,
    lastSubmittedAt: temporal.lastSubmittedAt,
    answers: fallbackAnswers,
    origin: "synthetic",
    path,
  };
  return { response, signature: answerSignature(fallbackAnswers) };
};
