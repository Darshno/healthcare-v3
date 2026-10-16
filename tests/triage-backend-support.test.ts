import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bull";
import { TriageQueueProcessor, parseDecisionSupportOutput, type TriageJob } from "../server/queue/triage-queue.processor";
import { invokeLLM } from "../server/_core/llm";

vi.mock("../server/_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

const makeProcessor = () => {
  const cache = { set: vi.fn().mockResolvedValue(undefined) };
  const repository = {
    create: vi.fn((value) => value),
    save: vi.fn().mockResolvedValue(undefined),
  };
  return {
    processor: new TriageQueueProcessor(cache as never, repository as never),
    cache,
    repository,
  };
};

const makeJob = (symptomText: string): Job<TriageJob> =>
  ({
    data: {
      patientId: 41,
      hospitalId: 8,
      serviceType: "OPD",
      screeningData: {
        age: 34,
        pregnancyStatus: "not pregnant",
        vitalSigns: {},
      },
      symptomText,
    },
  }) as unknown as Job<TriageJob>;

describe("Backend triage decision support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("keeps emergency escalation deterministic and never sends red-flag symptoms to the model", async () => {
    vi.stubEnv("TRIAGE_LLM_SUPPORT_ENABLED", "true");
    vi.mocked(invokeLLM).mockResolvedValue({
      id: "mock",
      created: 0,
      model: "mock",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: '{"organizedSymptoms":[],"followUpQuestions":[],"urgency":"routine"}',
          },
          finish_reason: "stop",
        },
      ],
    });
    const { processor } = makeProcessor();

    const result = await processor.handleAssess(makeJob("Patient reports chest pain"));

    expect(result.careCategory).toBe("emergency");
    expect(result.structuredTriage.urgency).toBe("emergency");
    expect(result.structuredTriage.requiresHumanReview).toBe(true);
    expect(invokeLLM).not.toHaveBeenCalled();
  });

  it("rejects malformed or out-of-contract model output", () => {
    expect(parseDecisionSupportOutput("not json")).toBeNull();
    expect(
      parseDecisionSupportOutput('{"organizedSymptoms":[],"followUpQuestions":[],"urgency":"emergency"}'),
    ).toBeNull();
    expect(parseDecisionSupportOutput('{"organizedSymptoms":["pain"],"followUpQuestions":[]}')).toEqual({
      organizedSymptoms: ["pain"],
      followUpQuestions: [],
    });
  });

  it("falls back safely when the provider fails or its key is unavailable", async () => {
    vi.stubEnv("TRIAGE_LLM_SUPPORT_ENABLED", "true");
    vi.mocked(invokeLLM).mockRejectedValue(new Error("provider unavailable"));
    const { processor } = makeProcessor();

    const result = await processor.handleAssess(makeJob("Mild cough"));

    expect(result.structuredTriage.urgency).toBe(result.careCategory);
    expect(result.structuredTriage.requiresHumanReview).toBe(true);
    expect(result.structuredTriage.decisionSupport).toBeUndefined();
  });

  it("does not call an external provider unless explicitly enabled", async () => {
    const { processor } = makeProcessor();

    const result = await processor.handleAssess(makeJob("Mild cough"));

    expect(invokeLLM).not.toHaveBeenCalled();
    expect(result.structuredTriage.requiresHumanReview).toBe(true);
  });
});
