// Wave 6 — Unified LLM client used by AI features (persona generation,
// MediScore explainer, conversation assist, outreach drafts, dispute
// classifier, etc.). Three backends:
//
//   1. OpenAI (when OPENAI_API_KEY set) — gpt-4o-mini
//   2. Anthropic (when ANTHROPIC_API_KEY set) — claude-haiku
//   3. Deterministic stub (no keys) — templated response based on input hash,
//      so unit tests pass without network.
//
// The stub is intentionally deterministic so feature tests can assert on
// fixed strings. All callers should treat `text` as untrusted (the LLM may
// hallucinate); pass `jsonSchema` to coerce structured output when needed.

export interface ChatRequest {
  system?: string;
  user: string;
  jsonSchema?: unknown;
  maxTokens?: number;
}

export interface ChatResponse {
  text: string;
  raw?: unknown;
  modelUsed: string;
}

export async function chat(req: ChatRequest): Promise<ChatResponse> {
  if (process.env.OPENAI_API_KEY) {
    try {
      return await openaiChat(req);
    } catch (err: any) {
      console.warn("[llm] openai failed, falling back to stub:", err?.message);
      return stubChat(req);
    }
  }
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await anthropicChat(req);
    } catch (err: any) {
      console.warn("[llm] anthropic failed, falling back to stub:", err?.message);
      return stubChat(req);
    }
  }
  return stubChat(req);
}

async function openaiChat(req: ChatRequest): Promise<ChatResponse> {
  const messages: Array<{ role: string; content: string }> = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  messages.push({ role: "user", content: req.user });

  const body: Record<string, unknown> = {
    model: "gpt-4o-mini",
    messages,
    max_tokens: req.maxTokens ?? 1024,
  };
  if (req.jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "response", schema: req.jsonSchema, strict: true },
    };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`);
  }
  const data: any = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  return { text, raw: data, modelUsed: "openai:gpt-4o-mini" };
}

async function anthropicChat(req: ChatRequest): Promise<ChatResponse> {
  const body: Record<string, unknown> = {
    model: "claude-haiku-4-5",
    max_tokens: req.maxTokens ?? 1024,
    messages: [{ role: "user", content: req.user }],
  };
  if (req.system) body.system = req.system;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
  }
  const data: any = await res.json();
  const text = Array.isArray(data?.content)
    ? data.content.map((b: any) => b?.text ?? "").join("")
    : "";
  return { text, raw: data, modelUsed: "anthropic:claude-haiku" };
}

/**
 * Deterministic stub: hashes the first 80 chars of the user prompt and
 * returns a templated response so tests can assert on stable strings.
 *
 * If `jsonSchema` is set we return a minimal JSON object {"stub": true,
 * "key": <hash>} — feature code is expected to tolerate this in test env.
 */
export function stubChat(req: ChatRequest): ChatResponse {
  const key = simpleHash(req.user.slice(0, 80));
  const text = req.jsonSchema
    ? JSON.stringify({ stub: true, key })
    : `[stub:${key}] ${req.user.slice(0, 60)}`;
  return { text, modelUsed: "stub", raw: { stub: true, key } };
}

function simpleHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
