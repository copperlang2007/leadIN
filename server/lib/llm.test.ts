import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chat, stubChat } from "./llm.js";

describe("llm stub backend", () => {
  let savedOpenAi: string | undefined;
  let savedAnthropic: string | undefined;
  beforeEach(() => {
    savedOpenAi = process.env.OPENAI_API_KEY;
    savedAnthropic = process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    if (savedOpenAi !== undefined) process.env.OPENAI_API_KEY = savedOpenAi;
    if (savedAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = savedAnthropic;
  });

  it("returns deterministic stub text when no api keys are set", async () => {
    const a = await chat({ user: "hello world" });
    const b = await chat({ user: "hello world" });
    expect(a.modelUsed).toBe("stub");
    expect(b.text).toBe(a.text);
    expect(a.text).toContain("[stub:");
  });

  it("returns JSON-shaped stub when jsonSchema is set", async () => {
    const res = stubChat({ user: "summarize this", jsonSchema: { type: "object" } });
    const parsed = JSON.parse(res.text);
    expect(parsed.stub).toBe(true);
    expect(typeof parsed.key).toBe("string");
  });
});
