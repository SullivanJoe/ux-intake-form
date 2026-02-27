import { NextRequest, NextResponse } from "next/server";
import type { DesignRequestSummary, ReferenceConcept } from "@/app/types";

const SYSTEM_PROMPT = `You are an AI Design Intake Assistant. Given a structured Design Request Summary, create a low-fidelity UX concept (Reference Concept) to support the request. This is not a final design—it is a thinking aid to accelerate alignment.

Output a JSON object only (no markdown, no code fences) with exactly these keys:
- experienceGoal: What the design should help achieve (1–2 sentences)
- suggestedLayout: High-level structure—panels, flows, hierarchy (short paragraph or bullet summary)
- keyElements: Core features or modules (bullet or short list)
- interactionModel: How the user moves through the experience (short paragraph)
- designConsiderations: Behavior, edge cases, scalability, permissions, accessibility (short paragraph or bullets)

Keep each value concise and actionable.`;

type OpenAIResponse = {
  experienceGoal?: string;
  suggestedLayout?: string;
  keyElements?: string;
  interactionModel?: string;
  designConsiderations?: string;
};

async function generateConceptWithOpenAI(
  summary: DesignRequestSummary
): Promise<{ ok: true; data: ReferenceConcept } | { ok: false; error: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "OPENAI_API_KEY is not set." };
  }

  const userContent = `Design Request Summary:\nProblem: ${summary.problem}\nDesired Outcome: ${summary.desiredOutcome}\nUsers Impacted: ${summary.usersImpacted}\nBusiness Value: ${summary.businessValue}\nConstraints: ${summary.constraints}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        temperature: 0.4,
        max_tokens: 1000,
      }),
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      let message = `OpenAI error (${res.status})`;
      try {
        const errJson = JSON.parse(errText) as { error?: { message?: string } };
        if (errJson?.error?.message) message = errJson.error.message.slice(0, 150);
      } catch {
        // ignore
      }
      return { ok: false, error: message };
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return { ok: false, error: "OpenAI returned an empty response." };

    const raw = content.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    let parsed: OpenAIResponse;
    try {
      parsed = JSON.parse(raw) as OpenAIResponse;
    } catch {
      return { ok: false, error: "OpenAI response was not valid JSON." };
    }

    const concept: ReferenceConcept = {
      experienceGoal: typeof parsed.experienceGoal === "string" ? parsed.experienceGoal : "—",
      suggestedLayout: typeof parsed.suggestedLayout === "string" ? parsed.suggestedLayout : "—",
      keyElements: typeof parsed.keyElements === "string" ? parsed.keyElements : "—",
      interactionModel: typeof parsed.interactionModel === "string" ? parsed.interactionModel : "—",
      designConsiderations: typeof parsed.designConsiderations === "string" ? parsed.designConsiderations : "—",
    };
    return { ok: true, data: concept };
  } catch (e) {
    clearTimeout(timeoutId);
    if ((e as Error).name === "AbortError") {
      return { ok: false, error: "Request timed out. Try again." };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Request failed." };
  }
}

function placeholderConcept(summary: DesignRequestSummary): ReferenceConcept {
  return {
    experienceGoal: summary.desiredOutcome || "—",
    suggestedLayout: "—",
    keyElements: "—",
    interactionModel: "—",
    designConsiderations: summary.constraints || "—",
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const summary = body as DesignRequestSummary;

    if (!summary || typeof summary.problem !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid Design Request Summary" },
        { status: 400 }
      );
    }

    const result = await generateConceptWithOpenAI(summary);

    if (result.ok) {
      return NextResponse.json(result.data);
    }

    return NextResponse.json(placeholderConcept(summary), {
      headers: { "X-OpenAI-Error": result.error },
    });
  } catch (e) {
    console.error("[generate-visual-concept] error:", e);
    return NextResponse.json(
      { error: "Failed to generate visual concept" },
      { status: 500 }
    );
  }
}
