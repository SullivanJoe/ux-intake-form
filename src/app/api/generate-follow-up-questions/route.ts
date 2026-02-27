import { NextRequest, NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are an AI Design Intake Assistant. Based on what the user has shared (project basics and objectives/outcomes), generate a short intro line and 2–5 follow-up questions for the next step: Constraints & Considerations.

Critical: Every question must reflect and build upon their previous response. Use the exact names and terms they used (e.g. project name like "Fleetloader", initiatives like "SFP integration", outcomes they mentioned). Do not use generic placeholders like "[project name]" in the final output—use the actual name or term they gave.

Style for questions:
- Reference their specific experience or product by name: "What problem the current [their project/product name] experience has?"
- Tie to their stated goals: "What specifically needs to change to enable [initiative they mentioned, e.g. SFP integration]?"
- Include scope/type when relevant: "Whether this is a UX overhaul, workflow redesign, data integration layer, or all of the above?"
- Other angles: technical constraints, operational realities, scale, or dependencies—still phrased using their context and terms.

Intro: One sentence that references something they said (e.g. "You mentioned the redesign is to integrate with SFP." or "You're focused on Fleetloader and reducing claim time."). Then the questions list follows.

Example format (use their actual terms, not these exact words):
intro: "You mentioned the redesign is to integrate with SFP."
questions: [
  "What problem the current Fleetloader experience has?",
  "What specifically needs to change to enable SFP integration?",
  "Whether this is a UX overhaul, workflow redesign, data integration layer, or all of the above?"
]

Output a JSON object only (no markdown, no code fences):
{"intro":"...","questions":["...","...","..."]}

Keep intro to 1–2 sentences. Each question must be one clear sentence and must incorporate specifics from their opening and objectives (product name, initiative, or outcome).`;

type OpenAIResponse = {
  intro?: string;
  questions?: string[];
};

async function generateWithOpenAI(
  opening: string,
  objectives: string
): Promise<{ ok: true; data: { intro: string; questions: string[] } } | { ok: false; error: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "OPENAI_API_KEY is not set." };
  }

  const userContent = `What they shared so far:\n\nBasics / project: ${opening}\n\nObjectives and outcomes: ${objectives}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20_000);

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
        max_tokens: 600,
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

    const intro = typeof parsed.intro === "string" ? parsed.intro.trim() : "";
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      : [];

    if (!intro && questions.length === 0) {
      return { ok: false, error: "OpenAI did not return intro or questions." };
    }

    return {
      ok: true,
      data: {
        intro: intro || "Could you share a bit more about:",
        questions: questions.length > 0 ? questions : ["What constraints or considerations should we know about?"],
      },
    };
  } catch (e) {
    clearTimeout(timeoutId);
    if ((e as Error).name === "AbortError") {
      return { ok: false, error: "Request timed out." };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Request failed." };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { opening = "", objectives = "" } = body as { opening?: string; objectives?: string };

    const openingStr = String(opening ?? "").trim();
    const objectivesStr = String(objectives ?? "").trim();

    if (!openingStr && !objectivesStr) {
      return NextResponse.json(
        { error: "At least one of opening or objectives is required." },
        { status: 400 }
      );
    }

    const result = await generateWithOpenAI(openingStr, objectivesStr);

    if (result.ok) {
      return NextResponse.json(result.data);
    }

    return NextResponse.json(
      { error: result.error },
      { status: 502 }
    );
  } catch (e) {
    console.error("[generate-follow-up-questions] error:", e);
    return NextResponse.json(
      { error: "Failed to generate follow-up questions." },
      { status: 500 }
    );
  }
}
