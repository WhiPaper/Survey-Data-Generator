import { describe, expect, it } from "vitest";

import { GoogleFormNormalizer, GoogleResponseNormalizer } from "../electron/main/forms/normalizer";

const routingForm = {
  formId: "form-routing",
  info: { title: "Routing survey" },
  items: [
    {
      itemId: "route-item",
      title: "Path",
      questionItem: {
        question: {
          questionId: "route",
          required: true,
          choiceQuestion: {
            type: "RADIO",
            options: [
              { value: "Continue", goToSectionId: "details" },
              { value: "Finish", goToAction: "SUBMIT_FORM" },
            ],
          },
        },
      },
    },
    { itemId: "details", title: "Details", pageBreakItem: {} },
    {
      itemId: "comment-item",
      title: "Comment",
      questionItem: {
        question: {
          questionId: "comment",
          textQuestion: { paragraph: true },
        },
      },
    },
  ],
};

describe("Google Form v2 normalizer", () => {
  it("keeps API-confirmed branching and marks navigation questions", () => {
    const form = new GoogleFormNormalizer().normalize(routingForm, "2026-09-01T00:00:00.000Z");
    const route = form.questions.find((question) => question.id === "route");
    if (route?.kind !== "single_choice") throw new Error("expected route choice");

    expect(route.affectsNavigation).toBe(true);
    expect(form.logic.transitions).toEqual([
      {
        sourceQuestionId: "route",
        optionKey: route.options[0]?.key,
        destination: { type: "section", sectionId: "details" },
        evidence: "api_confirmed",
      },
      {
        sourceQuestionId: "route",
        optionKey: route.options[1]?.key,
        destination: { type: "submit" },
        evidence: "api_confirmed",
      },
    ]);
  });

  it("distinguishes reached skips from not-reached answers", () => {
    const form = new GoogleFormNormalizer().normalize(routingForm);
    const responses = new GoogleResponseNormalizer().normalizeAll(form, [
      {
        responseId: "continue",
        lastSubmittedTime: "2026-09-01T00:01:00.000Z",
        answers: {
          route: { textAnswers: { answers: [{ value: "Continue" }] } },
        },
      },
      {
        responseId: "finish",
        lastSubmittedTime: "2026-09-01T00:02:00.000Z",
        answers: {
          route: { textAnswers: { answers: [{ value: "Finish" }] } },
        },
      },
    ]);

    expect(responses[0]?.answers.comment).toEqual({ state: "skipped" });
    expect(responses[1]?.answers.comment).toEqual({ state: "not_reached" });
  });

  it("keeps unknown question types as unsupported instead of failing import", () => {
    const form = new GoogleFormNormalizer().normalize({
      formId: "future-form",
      info: { title: "Future Form" },
      items: [
        {
          itemId: "future-item",
          title: "Future",
          questionItem: {
            question: { questionId: "future", futureQuestion: {} },
          },
        },
      ],
    });

    expect(form.questions[0]).toMatchObject({
      id: "future",
      kind: "unsupported",
      sourceType: "unknown",
    });
    expect(form.schemaHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
