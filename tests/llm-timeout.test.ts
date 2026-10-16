import { afterEach, describe, expect, it, vi } from "vitest";

describe("LLM request boundaries", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("aborts a provider request at the configured timeout", async () => {
    vi.stubEnv("BUILT_IN_FORGE_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
      ),
    );

    const { invokeLLM } = await import("../server/_core/llm");
    await expect(
      invokeLLM({
        messages: [{ role: "user", content: "anonymized symptom" }],
        timeoutMs: 20,
      }),
    ).rejects.toThrow("timed out");
  });
});
