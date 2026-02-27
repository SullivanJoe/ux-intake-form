import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { intentSummary, objectives } = body;

    if (!intentSummary) {
      return NextResponse.json(
        { error: "Missing intent summary" },
        { status: 400 }
      );
    }

    const truncatedIntent =
      String(intentSummary).length > 500
        ? String(intentSummary).slice(0, 500) + "…"
        : String(intentSummary);
    const objectivesStr = objectives != null ? String(objectives) : "";
    const truncatedObjectives =
      objectivesStr.length > 200 ? objectivesStr.slice(0, 200) + "…" : objectivesStr;

    const prompt = `
Create a clean SaaS product UI mockup.

Screen Purpose:
A UX Design Request Intake Assistant

User Goal:
${truncatedIntent}

Business Objectives:
${truncatedObjectives || "Not specified"}

Layout Should Include:
- AI assistant welcome panel
- User response area
- Request summary card
- Suggested solution preview
- Progress indicator

Style:
- Modern enterprise SaaS
- Wireframe fidelity
- Neutral tones
- Desktop layout
- Product management tooling feel

Goal:
Help teams visualize a structured design request flow before submission
`.trim();

    const finalPrompt = prompt.length > 1000 ? prompt.slice(0, 997) + "…" : prompt;

    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "dall-e-2",
        prompt: finalPrompt,
        n: 1,
        size: "1024x1024",
        response_format: "b64_json",
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Image generation failed:", data);
      const message = (data as { error?: { message?: string } })?.error?.message || "Image generation failed";
      return NextResponse.json(
        { error: message, details: data },
        { status: response.status }
      );
    }

    const first = Array.isArray((data as { data?: unknown[] }).data)
      ? (data as { data: unknown[] }).data[0]
      : null;
    const imagePayload = first as { b64_json?: string; url?: string } | null;

    if (imagePayload?.b64_json) {
      return NextResponse.json({ image: imagePayload.b64_json });
    }
    if (imagePayload?.url) {
      return NextResponse.json({ imageUrl: imagePayload.url });
    }

    console.error("Unexpected image response shape:", data);
    return NextResponse.json(
      { error: "Image response missing b64_json or url" },
      { status: 500 }
    );

  } catch (e) {
    console.error("generate-mockup error:", e);
    return NextResponse.json(
      { error: "Mockup generation failed" },
      { status: 500 }
    );
  }
}