process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import { NextRequest, NextResponse } from "next/server";
import type { SectionKey, SectionFeedback, RiskFlag } from "@/app/types";

const EVALUATION_SYSTEM_PROMPT = `You are a UX intake coach. Evaluate the user's response for the given section of a product/UX intake form.

Your role:
- Do NOT block or reject submissions. Always allow the user to proceed.
- Identify areas to strengthen and provide brief, actionable suggested improvements.
- Assign a risk_delta (number -10 to +25) that will contribute to a cumulative risk score: negative = lower risk, positive = higher risk.
- Optionally add flags when you detect: "Solution Bias" (solution described before problem), "Missing Metrics" (no success criteria), "Strategic Misalignment" (conflicts with roadmap/strategy), "Dependency Risk" (unclear or high dependencies).
- Tone: Inject a bit of light, friendly humor in your feedback when it fits—warm, gently witty, or playful—so the experience feels human and approachable. Keep it professional and never at the user's expense.

Respond with a JSON object only, no markdown, no code fences, no extra text:
{"feedback":"...","suggestedImprovements":["...","..."],"riskDelta":number,"flags":["FlagName"]}`;

const OPENING_EXTRA = `This section is the opening: the user was asked "What's the project name, and is this a new initiative or part of an existing product?" 
Acknowledge what they shared and confirm you have the project name and whether it's new or existing. If something is missing or unclear, ask briefly for that (e.g. "Could you confirm whether this is a new initiative or part of an existing product?"). Keep feedback to 1-2 sentences.`;

const OBJECTIVES_OUTCOMES_EXTRA = `This section is "Objectives and Outcomes". Focus on whether the user has stated clear objectives and desired outcomes. If the response is vague, short, or incomplete, your feedback must ask them to be more specific: what exactly do they want to achieve? What does success look like? Include concrete suggested improvements so they can add the missing detail.`;

function getSystemPrompt(section: string): string {
  if (section === "Opening") {
    return `${EVALUATION_SYSTEM_PROMPT}\n\n${OPENING_EXTRA}`;
  }
  if (section === "Objectives and Outcomes") {
    return `${EVALUATION_SYSTEM_PROMPT}\n\n${OBJECTIVES_OUTCOMES_EXTRA}`;
  }
  return EVALUATION_SYSTEM_PROMPT;
}

type OpenAIEvaluation = {
  feedback?: string;
  suggestedImprovements?: string[];
  riskDelta?: number;
  risk_delta?: number;
  flags?: string[];
};

async function evaluateWithOpenAI(
  section: string,
  input: string
): Promise<{ ok: true; data: Omit<SectionFeedback, "section"> } | { ok: false; error: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    return { ok: false, error: "OPENAI_API_KEY is not set. Add it to .env.local and restart the server." };
  }

  const userMessage = `Section: ${section}\n\nUser response:\n${input}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: getSystemPrompt(section) },
          { role: "user", content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      console.error("OpenAI API error:", res.status, errText);
      let message: string;
      if (res.status === 401) {
        message = "Invalid OpenAI API key (401). Check OPENAI_API_KEY in .env.local.";
      } else if (res.status === 429) {
        message = "OpenAI rate limit exceeded (429). Try again in a moment.";
      } else if (res.status >= 500) {
        message = "OpenAI server error. Try again later.";
      } else {
        try {
          const errJson = JSON.parse(errText) as { error?: { message?: string } };
          const detail = errJson?.error?.message?.slice(0, 100);
          message = detail ? `OpenAI error: ${detail}` : `OpenAI error (${res.status}). Check server logs.`;
        } catch {
          message = `OpenAI error (${res.status}). Check server logs.`;
        }
      }
      return { ok: false, error: message };
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return { ok: false, error: "OpenAI returned an empty response. Try again." };
    }

    // Parse JSON (strip optional markdown code block)
    const raw = content.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    let parsed: OpenAIEvaluation;
    try {
      parsed = JSON.parse(raw) as OpenAIEvaluation;
    } catch {
      return { ok: false, error: "OpenAI response was not valid JSON. Try again." };
    }

    const feedback = typeof parsed.feedback === "string" ? parsed.feedback : "Thanks for sharing.";
    const suggestedImprovements = Array.isArray(parsed.suggestedImprovements)
      ? parsed.suggestedImprovements.filter((s): s is string => typeof s === "string")
      : [];
    const riskDelta = typeof parsed.riskDelta === "number"
      ? parsed.riskDelta
      : typeof parsed.risk_delta === "number"
        ? parsed.risk_delta
        : 10;
    const flags: RiskFlag[] = Array.isArray(parsed.flags)
      ? parsed.flags.filter((f): f is string => typeof f === "string")
      : [];

    return {
      ok: true,
      data: {
        feedback,
        suggestedImprovements: suggestedImprovements.length > 0 ? suggestedImprovements : ["Review section guidelines and add specifics."],
        riskDelta: Math.min(25, Math.max(-10, riskDelta)),
        flags,
        source: "openai",
      },
    };
  } catch (e) {
    clearTimeout(timeoutId);
    if ((e as Error).name === "AbortError") {
      console.error("OpenAI request timed out after 20s.");
      return { ok: false, error: "Request timed out (20s). Check your connection and try again." };
    }
    console.error("OpenAI evaluate error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    const isNetworkError =
      /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|network|socket hang up/i.test(msg);
    if (isNetworkError) {
      return {
        ok: false,
        error:
          "Network error: could not reach OpenAI. Common causes: VPN or firewall blocking api.openai.com, no internet, or corporate proxy. Try a different network (e.g. phone hotspot) or check with your IT team.",
      };
    }
    return { ok: false, error: `OpenAI request failed: ${msg}` };
  }
}

/**
 * v1 mock: keyword-based evaluation (no OpenAI).
 * Risk delta capped at 20 per section.
 */
function evaluateWithPlaceholder(
  section: string,
  input: string
): Omit<SectionFeedback, "section"> {
  const text = (input || "").trim();

  if (section === "Opening") {
    if (!text || text.length < 3) {
      return {
        feedback: "Please share the project name and whether it's a new initiative or part of an existing product.",
        suggestedImprovements: ["Add the project name and indicate new vs existing initiative."],
        riskDelta: 5,
        flags: ["Incomplete Answer"],
        source: "placeholder",
      };
    }
    const hasNewOrExisting = /new|existing|current|initiative|product|redesign|part of/i.test(text);
    return {
      feedback: hasNewOrExisting
        ? "Thanks, that helps. We'll use this as we go through the next questions."
        : "Thanks for the project name. Could you confirm whether this is a new initiative or part of an existing product?",
      suggestedImprovements: hasNewOrExisting ? [] : ["Clarify if this is a new initiative or part of an existing product."],
      riskDelta: hasNewOrExisting ? 0 : 3,
      flags: [],
      source: "placeholder",
    };
  }

  let feedback = "";
  let riskDelta = 0;
  const flags: RiskFlag[] = [];
  const suggestedImprovements: string[] = [];
  const isObjectivesSection = section === "Objectives and Outcomes";

  if (!text || text.length < 10) {
    feedback = isObjectivesSection
      ? "Please be more specific. What objectives do you want to achieve? What does success look like for this project? Adding concrete outcomes will help the design team plan effectively."
      : "Your answer is quite short. Consider adding more detail to fully describe this section.";
    riskDelta += 5;
    flags.push("Incomplete Answer");
    suggestedImprovements.push(
      isObjectivesSection
        ? "State clear objectives and desired outcomes (what success looks like)."
        : "Add more detail to fully describe this section."
    );
  }

  if (text.length >= 10 && text.length < 50 && isObjectivesSection) {
    feedback += (feedback ? " " : "") + "Can you add more detail? For example: what improvement are you expecting, and why does this matter to the business or users?";
    if (!suggestedImprovements.some((s) => s.includes("improvement"))) {
      suggestedImprovements.push("Add expected improvement and business or user impact.");
    }
  }

  if (/dashboard|page|screen/i.test(text)) {
    feedback += (feedback ? " " : "") + "This sounds solution-focused. Try describing the underlying problem or outcome instead of the UI.";
    riskDelta += 5;
    if (!flags.includes("Solution Bias")) flags.push("Solution Bias");
    suggestedImprovements.push("Describe the underlying problem or outcome instead of the UI.");
  }

  if (/metric|percent|time/i.test(text)) {
    feedback += (feedback ? " " : "") + "Good, you included measurable outcomes.";
  } else {
    feedback += (feedback ? " " : "") + "Consider adding a measurable outcome to strengthen this request.";
    riskDelta += 3;
    if (!flags.includes("Missing Metrics")) flags.push("Missing Metrics");
    suggestedImprovements.push("Add a measurable outcome to strengthen this request.");
  }

  if (/team|stakeholder|dependency/i.test(text)) {
    feedback += (feedback ? " " : "") + "Nice, you mentioned stakeholders or dependencies.";
  } else {
    feedback += (feedback ? " " : "") + "Include relevant teams, stakeholders, or dependencies.";
    riskDelta += 2;
    if (!flags.includes("Dependency Risk")) flags.push("Missing Stakeholders/Dependencies");
    suggestedImprovements.push("Include relevant teams, stakeholders, or dependencies.");
  }

  if (riskDelta > 20) riskDelta = 20;
  if (!feedback.trim()) feedback = "Thanks for sharing. Consider adding more detail to strengthen this section.";

  return {
    feedback: feedback.trim(),
    suggestedImprovements: suggestedImprovements.length > 0 ? suggestedImprovements : ["Review section guidelines and add specifics."],
    riskDelta,
    flags,
    source: "placeholder",
  };
}

export async function POST(req: Request) {
  console.log("API KEY LOADED:", process.env.OPENAI_API_KEY ? "YES" : "NO");
  try {
    const body = await req.json();
    const { section, input } = body as { section?: string; input?: string };

    console.log("[evaluate-section] Request received, section:", section ?? "(missing)");

    if (!section || typeof input !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid section or input" },
        { status: 400 }
      );
    }

    const validSections: (SectionKey | "Opening")[] = [
      "Opening",
      "Objectives and Outcomes",
      "Constraints and Considerations",
    ];
    if (!validSections.includes(section as SectionKey | "Opening")) {
      return NextResponse.json(
        { error: "Invalid section name" },
        { status: 400 }
      );
    }

    // Opening: evaluate project name / new vs existing, then return feedback
    if (section === "Opening") {
      const result = await evaluateWithOpenAI("Opening", input);
      if (result.ok) {
        return NextResponse.json({ section: "Opening", ...result.data });
      }
      const fallback = evaluateWithPlaceholder("Opening", input);
      return NextResponse.json({
        section: "Opening",
        ...fallback,
        openaiError: result.error,
      });
    }

    // Constraints and Considerations: optional evaluation (same as other sections)
    if (section === "Constraints and Considerations") {
      const result = await evaluateWithOpenAI(section as SectionKey, input);
      if (result.ok) {
        return NextResponse.json({ section: section as SectionKey, ...result.data });
      }
      const fallback = evaluateWithPlaceholder(section as SectionKey, input);
      return NextResponse.json({
        section: section as SectionKey,
        ...fallback,
        openaiError: result.error,
      });
    }

    // Problem Framing & Objectives: try OpenAI first; if it fails, use placeholder and include why (for testing)
    console.log("[evaluate-section] section:", section, "| OPENAI_API_KEY set:", !!process.env.OPENAI_API_KEY?.trim());

    const result = await evaluateWithOpenAI(section as SectionKey, input);

    if (result.ok) {
      console.log("[evaluate-section] OpenAI success for", section);
      return NextResponse.json({
        section: section as SectionKey,
        ...result.data,
      });
    }

    // OpenAI failed: use placeholder but include the error so you can see why (for testing)
    console.log("[evaluate-section] OpenAI failed for", section, ":", result.error, "- using placeholder with openaiError");
    const fallback = evaluateWithPlaceholder(section as SectionKey, input);
    return NextResponse.json({
      section: section as SectionKey,
      ...fallback,
      openaiError: result.error,
    });
  } catch (e) {
    console.error("evaluate-section error:", e);
    return NextResponse.json(
      { error: "Evaluation failed" },
      { status: 500 }
    );
  }
}
