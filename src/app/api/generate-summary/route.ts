import { NextRequest, NextResponse } from "next/server";
import type { DesignRequestSummary } from "@/app/types";

const SYSTEM_PROMPT = `You are an AI Design Intake Assistant. Given the user's conversational input across four areas, produce a structured Design Request Summary.

Output a JSON object only (no markdown, no code fences) with exactly these keys:
- problem: What is happening today? Who is impacted? What friction or inefficiency exists? What is not working? (concise paragraph)
- desiredOutcome: What success looks like and what improvement or outcome is desired (concise paragraph)
- usersImpacted: Who is affected—roles, teams, or user segments (concise)
- businessValue: Why this matters to the business or users (concise)
- constraints: Technical limitations, operational realities, licensing, scale, workflow dependencies (concise)

Keep each value clear and concise. Use the user's own words where possible.`;

type OpenAIResponse = {
  problem?: string;
  desiredOutcome?: string;
  usersImpacted?: string;
  businessValue?: string;
  constraints?: string;
};

async function generateSummaryWithOpenAI(
  opening: string,
  problemFraming: string,
  objectives: string,
  constraints: string
): Promise<{ ok: true; data: DesignRequestSummary } | { ok: false; error: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "OPENAI_API_KEY is not set. Add it to .env.local and restart the server." };
  }

  const userContent = `Opening / how can I help: ${opening}\n\nProblem Framing: ${problemFraming}\n\nObjectives & Business Impact: ${objectives}\n\nConstraints & Considerations: ${constraints}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25_000);

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
        temperature: 0.3,
        max_tokens: 800,
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
        // use default
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

    const summary: DesignRequestSummary = {
      problem: typeof parsed.problem === "string" ? parsed.problem : "—",
      desiredOutcome: typeof parsed.desiredOutcome === "string" ? parsed.desiredOutcome : "—",
      usersImpacted: typeof parsed.usersImpacted === "string" ? parsed.usersImpacted : "—",
      businessValue: typeof parsed.businessValue === "string" ? parsed.businessValue : "—",
      constraints: typeof parsed.constraints === "string" ? parsed.constraints : "—",
    };
    return { ok: true, data: summary };
  } catch (e) {
    clearTimeout(timeoutId);
    if ((e as Error).name === "AbortError") {
      return { ok: false, error: "Request timed out. Try again." };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Request failed." };
  }
}

/** Placeholder when OpenAI is unavailable */
function placeholderSummary(
  opening: string,
  problemFraming: string,
  objectives: string,
  constraints: string
): DesignRequestSummary {
  return {
    problem: problemFraming?.trim() || opening?.trim() || "—",
    desiredOutcome: objectives?.trim() || "—",
    usersImpacted: "—",
    businessValue: "—",
    constraints: constraints?.trim() || "—",
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      opening = "",
      problemFraming = "",
      objectives = "",
      constraints = "",
    } = body as { opening?: string; problemFraming?: string; objectives?: string; constraints?: string };

    const result = await generateSummaryWithOpenAI(
      String(opening),
      String(problemFraming),
      String(objectives),
      String(constraints)
    );

    if (result.ok) {
      return NextResponse.json(result.data);
    }

    return NextResponse.json(
      placeholderSummary(
        String(opening),
        String(problemFraming),
        String(objectives),
        String(constraints)
      ),
      { headers: { "X-OpenAI-Error": result.error } }
    );
  } catch (e) {
    console.error("[generate-summary] error:", e);
    return NextResponse.json(
      { error: "Failed to generate summary" },
      { status: 500 }
    );
  }
}
