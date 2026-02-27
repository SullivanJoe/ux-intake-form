import { NextResponse } from "next/server";

/**
 * GET /api/openai-check
 * Diagnose OpenAI: is the key set, and can we reach the API?
 * Open in browser: http://localhost:3000/api/openai-check
 */
export async function GET() {
  const keySet = !!process.env.OPENAI_API_KEY?.trim();

  if (!keySet) {
    return NextResponse.json({
      keySet: false,
      message: "OPENAI_API_KEY is not set in .env.local. Add it and restart the server.",
    });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
      }),
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      return NextResponse.json({
        keySet: true,
        reachable: true,
        message: "OpenAI is working. Feedback in the form will use AI.",
      });
    }

    const errText = await res.text();
    let detail = `HTTP ${res.status}`;
    try {
      const errJson = JSON.parse(errText) as { error?: { message?: string } };
      if (errJson?.error?.message) detail = errJson.error.message.slice(0, 150);
    } catch {
      // use status
    }

    return NextResponse.json({
      keySet: true,
      reachable: false,
      error: detail,
      message:
        res.status === 401
          ? "Invalid API key. Create a new key at platform.openai.com and update .env.local."
          : res.status === 429
            ? "Rate limited. Try again in a moment."
            : `OpenAI returned an error: ${detail}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isNetwork =
      /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|AbortError/i.test(msg);

    return NextResponse.json({
      keySet: true,
      reachable: false,
      error: msg,
      message: isNetwork
        ? "Cannot reach OpenAI (network error). Try: different network (e.g. phone hotspot), turn off VPN, or ask IT to allow api.openai.com."
        : `Request failed: ${msg}`,
    });
  }
}
