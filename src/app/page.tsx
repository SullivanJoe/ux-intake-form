"use client";

import { useState, useEffect } from "react";
import {
  SECTIONS,
  type SectionKey,
  type SectionFeedback,
  type RiskFlag,
  type IntakeSummary,
  type RecommendedAction,
  type DesignRequestSummary,
  type ReferenceConcept,
} from "@/app/types";

const OPENING_PROMPT =
  "Let's start with the basics — what's the project name, and is this a new initiative or part of an existing product?";

const OPENING_WELCOME = `Hi there, and welcome! I'm here to help you submit a Product Design Request. My goal is to make sure your request includes everything our design team needs to understand the work and plan effectively.

We'll go step-by-step through a few short questions about your project — things like the project name, business area, objectives, scope, and any supporting documentation. The more information you can provide now, the faster we can move your request into review. And if you don't have everything ready, that's okay — we can still capture what you do know and fill in the gaps together when we review it.`;

const OBJECTIVES_OUTCOMES_INTRO = {
  heading: "Objectives and Outcomes",
  intro:
    "Define what you want to achieve and what success looks like. Be as specific as you can — we'll ask you to add more detail if something is unclear.",
  prompts: [
    "What are the main objectives for this project?",
    "What does success look like? (concrete outcomes)",
    "What improvement or change do you expect?",
    "Why does this matter to the business or users?",
  ],
} as const;

const CONSTRAINTS_INTRO = {
  heading: "Constraints & Considerations",
  intro:
    "Clarify any limits or dependencies that will shape the solution.",
  prompts: [
    "Technical limitations",
    "Operational realities",
    "Licensing limits",
    "Scale considerations",
    "Workflow dependencies",
  ],
} as const;

const SECTION_INTROS: Record<SectionKey, { heading: string; intro: string; prompts: readonly string[] }> = {
  "Objectives and Outcomes": OBJECTIVES_OUTCOMES_INTRO,
  "Constraints and Considerations": CONSTRAINTS_INTRO,
};

function getRecommendedAction(riskScore: number, flags: RiskFlag[]): RecommendedAction {
  if (flags.some((f) => f === "Strategic Misalignment") || riskScore >= 70) {
    return "Strategic Review Required";
  }
  if (flags.length > 0 || riskScore >= 45) {
    return "Clarification Call Recommended";
  }
  return "Backlog Ready";
}

const STEP_OPENING = 0;
const STEP_FIRST_SECTION = 1;
const STEP_LAST_SECTION = 2;
const STEP_SUMMARY = 3;
const STEP_OFFER_VISUAL = 4;
const STEP_VISUAL_CONCEPT = 5;
const STEP_FINAL = 6;

export default function IntakeWizard() {
  const [currentStep, setCurrentStep] = useState(0);
  const [openingResponse, setOpeningResponse] = useState("");
  const [sectionValues, setSectionValues] = useState<Record<SectionKey, string>>({
    "Objectives and Outcomes": "",
    "Constraints and Considerations": "",
  });
  const [cumulativeRisk, setCumulativeRisk] = useState(0);
  const [allFlags, setAllFlags] = useState<RiskFlag[]>([]);
  const [feedbacks, setFeedbacks] = useState<Record<number, SectionFeedback>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [designRequestSummary, setDesignRequestSummary] = useState<DesignRequestSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [wantsVisualConcept, setWantsVisualConcept] = useState<boolean | null>(null);
  const [referenceConcept, setReferenceConcept] = useState<ReferenceConcept | null>(null);
  const [conceptLoading, setConceptLoading] = useState(false);
  const [conceptError, setConceptError] = useState<string | null>(null);
  const [showUxView, setShowUxView] = useState(false);
  const [followUpForConstraints, setFollowUpForConstraints] = useState<{
    intro: string;
    questions: string[];
  } | null>(null);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [mockupImage, setMockupImage] = useState<string | null>(null);
  const [mockupLoading, setMockupLoading] = useState(false);
  const [mockupError, setMockupError] = useState<string | null>(null);

  const isInSections = currentStep >= STEP_FIRST_SECTION && currentStep <= STEP_LAST_SECTION;
  const sectionIndex = currentStep - STEP_FIRST_SECTION;
  const section = isInSections ? SECTIONS[sectionIndex] : null;
  const sectionFeedback = section !== null ? feedbacks[currentStep] : undefined;
  const sectionIntro = section ? SECTION_INTROS[section] : null;

  const resetWizard = () => {
    setCurrentStep(0);
    setOpeningResponse("");
    setSectionValues({
      "Objectives and Outcomes": "",
      "Constraints and Considerations": "",
    });
    setCumulativeRisk(0);
    setAllFlags([]);
    setFeedbacks({});
    setError(null);
    setDesignRequestSummary(null);
    setSummaryError(null);
    setWantsVisualConcept(null);
    setReferenceConcept(null);
    setConceptError(null);
    setShowUxView(false);
    setFollowUpForConstraints(null);
    setFollowUpError(null);
    setMockupImage(null);
    setMockupError(null);
  };

  // Generate Design Request Summary when reaching step 4
  useEffect(() => {
    if (currentStep !== STEP_SUMMARY || designRequestSummary !== null || summaryLoading) return;
    setSummaryError(null);
    setSummaryLoading(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    fetch("/api/generate-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        opening: openingResponse,
        problemFraming: "",
        objectives: sectionValues["Objectives and Outcomes"],
        constraints: sectionValues["Constraints and Considerations"],
      }),
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data: DesignRequestSummary) => {
        if (data && typeof data.problem === "string") {
          setDesignRequestSummary(data);
        } else {
          setSummaryError("Could not generate summary.");
        }
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") {
          setSummaryError("Request timed out. Try again.");
        } else {
          setSummaryError(e instanceof Error ? e.message : "Failed to generate summary.");
        }
      })
      .finally(() => {
        clearTimeout(timeoutId);
        setSummaryLoading(false);
      });
  }, [currentStep, designRequestSummary, summaryLoading, openingResponse, sectionValues]);

  // Generate follow-up questions for Step 2 (Constraints) based on what was shared
  useEffect(() => {
    if (currentStep !== STEP_LAST_SECTION) return;
    const opening = openingResponse.trim();
    const objectives = sectionValues["Objectives and Outcomes"]?.trim() || "";
    if (!opening && !objectives) return;
    if (followUpForConstraints !== null || followUpLoading) return;

    setFollowUpError(null);
    setFollowUpLoading(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25_000);
    fetch("/api/generate-follow-up-questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opening, objectives }),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 502 ? "Could not generate questions. Using default prompts." : "Request failed");
        return res.json();
      })
      .then((data: { intro: string; questions: string[] }) => {
        if (data?.intro != null && Array.isArray(data.questions)) {
          setFollowUpForConstraints({ intro: data.intro, questions: data.questions });
        }
      })
      .catch(() => {
        setFollowUpError("Using default prompts.");
      })
      .finally(() => {
        clearTimeout(timeoutId);
        setFollowUpLoading(false);
      });
  }, [currentStep, openingResponse, sectionValues, followUpForConstraints, followUpLoading]);

  // Generate Reference Concept when user said Yes and we're on visual concept step (or when on Final and we skipped visual, so we still have reference concept for summary)
  useEffect(() => {
    const shouldGenerate =
      (currentStep === STEP_VISUAL_CONCEPT && wantsVisualConcept === true) ||
      (currentStep === STEP_FINAL && wantsVisualConcept === false);
    if (
      !shouldGenerate ||
      !designRequestSummary ||
      referenceConcept !== null ||
      conceptLoading
    )
      return;
    setConceptError(null);
    setConceptLoading(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 35_000);
    fetch("/api/generate-visual-concept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(designRequestSummary),
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data: ReferenceConcept) => {
        if (data && typeof data.experienceGoal === "string") {
          setReferenceConcept(data);
        } else {
          setConceptError("Could not generate visual concept.");
        }
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") {
          setConceptError("Request timed out. Try again.");
        } else {
          setConceptError(e instanceof Error ? e.message : "Failed to generate concept.");
        }
      })
      .finally(() => {
        clearTimeout(timeoutId);
        setConceptLoading(false);
      });
  }, [currentStep, designRequestSummary, wantsVisualConcept, referenceConcept, conceptLoading]);

  // Generate mockup image only when user said Yes and we're on visual concept step (run once; don't retry on error to avoid flicker loop)
  useEffect(() => {
    if (
      currentStep !== STEP_VISUAL_CONCEPT ||
      wantsVisualConcept !== true ||
      !designRequestSummary ||
      mockupImage !== null ||
      mockupLoading ||
      mockupError !== null
    )
      return;
    const intentSummary = [
      designRequestSummary.problem,
      designRequestSummary.desiredOutcome,
      designRequestSummary.constraints,
    ]
      .filter(Boolean)
      .join(" ");
    const objectives = sectionValues["Objectives and Outcomes"]?.trim() || undefined;
    setMockupError(null);
    setMockupLoading(true);
    fetch("/api/generate-mockup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intentSummary, objectives }),
    })
      .then((res) => res.json())
      .then((data: { image?: string; imageUrl?: string; error?: string }) => {
        if (data?.image) {
          setMockupImage(`data:image/png;base64,${data.image}`);
        } else if (data?.imageUrl) {
          setMockupImage(data.imageUrl);
        } else if (data?.error) {
          setMockupError(data.error);
        }
      })
      .catch(() => setMockupError("Mockup generation failed"))
      .finally(() => setMockupLoading(false));
  }, [currentStep, designRequestSummary, wantsVisualConcept, sectionValues, mockupImage, mockupLoading, mockupError]);

  const handleNext = async () => {
    if (currentStep === STEP_OPENING) {
      const trimmed = openingResponse.trim();
      const openingFeedback = feedbacks[STEP_OPENING];
      if (openingFeedback) {
        setCurrentStep(STEP_FIRST_SECTION);
        return;
      }
      if (!trimmed) {
        setError("Please share the project name and whether it's a new initiative or part of an existing product.");
        return;
      }
      setError(null);
      setLoading(true);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30_000);
      try {
        const res = await fetch("/api/evaluate-section", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section: "Opening", input: trimmed }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error || "Evaluation failed");
        }
        const data: SectionFeedback = await res.json();
        setFeedbacks((prev) => ({ ...prev, [STEP_OPENING]: data }));
        setCumulativeRisk((prev) => Math.min(100, Math.max(0, prev + data.riskDelta)));
        setAllFlags((prev) => {
          const next = [...prev];
          data.flags.forEach((f) => {
            if (!next.includes(f)) next.push(f);
          });
          return next;
        });
      } catch (e) {
        clearTimeout(timeoutId);
        setError(
          e instanceof Error && (e as Error).name === "AbortError"
            ? "Request timed out. Please try again."
            : e instanceof Error
              ? e.message
              : "Something went wrong"
        );
      } finally {
        setLoading(false);
      }
      return;
    }

    if (isInSections && section) {
      const value = sectionValues[section]?.trim() || "";
      if (sectionFeedback) {
        if (currentStep === STEP_LAST_SECTION) {
          setCurrentStep(STEP_SUMMARY);
        } else {
          setCurrentStep((prev) => prev + 1);
        }
        return;
      }
      if (!value) {
        setError("Please provide a response before continuing.");
        return;
      }
      setError(null);
      setLoading(true);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30_000);
      try {
        const res = await fetch("/api/evaluate-section", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section, input: value }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error || "Evaluation failed");
        }
        const data: SectionFeedback = await res.json();
        setFeedbacks((prev) => ({ ...prev, [currentStep]: data }));
        setCumulativeRisk((prev) => Math.min(100, Math.max(0, prev + data.riskDelta)));
        setAllFlags((prev) => {
          const next = [...prev];
          data.flags.forEach((f) => {
            if (!next.includes(f)) next.push(f);
          });
          return next;
        });
      } catch (e) {
        clearTimeout(timeoutId);
        setError(
          e instanceof Error && (e as Error).name === "AbortError"
            ? "Request timed out. Please try again."
            : e instanceof Error
              ? e.message
              : "Something went wrong"
        );
      } finally {
        setLoading(false);
      }
      return;
    }

    if (currentStep === STEP_SUMMARY) {
      setCurrentStep(STEP_OFFER_VISUAL);
      return;
    }

    if (currentStep === STEP_VISUAL_CONCEPT) {
      setCurrentStep(STEP_FINAL);
      return;
    }
  };

  const handleOfferVisual = (yes: boolean) => {
    setWantsVisualConcept(yes);
    if (yes) {
      setCurrentStep(STEP_VISUAL_CONCEPT);
    } else {
      setCurrentStep(STEP_FINAL);
    }
  };

  const summary: IntakeSummary = {
    problem_statement: openingResponse.trim() || "",
    desired_outcome: sectionValues["Objectives and Outcomes"] || "",
    risk_score: cumulativeRisk,
    flags: Array.from(new Set(allFlags)),
    designRequestSummary: designRequestSummary || undefined,
    referenceConcept: referenceConcept || undefined,
  };

  const recommendedAction = getRecommendedAction(cumulativeRisk, summary.flags);

  const progressStep =
    currentStep <= STEP_LAST_SECTION
      ? currentStep + 1
      : currentStep === STEP_SUMMARY
        ? 4
        : currentStep === STEP_OFFER_VISUAL
          ? 5
          : currentStep === STEP_VISUAL_CONCEPT
            ? 6
            : 7;

  // —— Step 0: Opening ——
  if (currentStep === STEP_OPENING) {
    const openingFeedback = feedbacks[STEP_OPENING];
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="glass-card p-8 space-y-6 shadow-2xl shadow-slate-900/50">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-2xl font-bold text-slate-100">Design Intake Assistant</h1>
            <button type="button" onClick={resetWizard} className="btn-ghost shrink-0">
              Reset
            </button>
          </div>
          <div className="space-y-4 text-slate-300 text-sm leading-relaxed">
            <p className="whitespace-pre-wrap">{OPENING_WELCOME}</p>
          </div>
          <div>
            <label htmlFor="opening" className="block text-sm font-medium text-slate-400 mb-2">
              {OPENING_PROMPT}
            </label>
            <textarea
              id="opening"
              value={openingResponse}
              onChange={(e) => setOpeningResponse(e.target.value)}
              placeholder="e.g. Project Alpha — new initiative to streamline field incident reporting."
              rows={8}
              className="w-full rounded-xl border border-slate-500/50 bg-slate-800/50 px-3 py-2 text-slate-100 placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none focus:ring-2 focus:ring-cyan-400/30 disabled:opacity-60"
              disabled={loading}
            />
          </div>
          {openingFeedback && (
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 space-y-2">
              {openingFeedback.openaiError && (
                <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  <span className="font-medium">OpenAI unavailable (showing placeholder):</span>{" "}
                  {openingFeedback.openaiError}
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-cyan-200">Feedback</p>
                {openingFeedback.source === "openai" && (
                  <span className="text-[10px] font-medium uppercase tracking-wider text-cyan-400/90 bg-cyan-500/20 px-2 py-0.5 rounded">
                    AI
                  </span>
                )}
              </div>
              <p className="text-sm text-cyan-100/90">{openingFeedback.feedback}</p>
              {openingFeedback.suggestedImprovements.length > 0 && (
                <>
                  <p className="text-sm font-medium text-cyan-200 mt-2">Suggested improvements</p>
                  <ul className="list-disc list-inside text-sm text-cyan-100/80 space-y-1">
                    {openingFeedback.suggestedImprovements.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </>
              )}
              <p className="text-xs text-cyan-200/70 mt-2">
                Risk delta: +{openingFeedback.riskDelta} → Cumulative: {cumulativeRisk}
              </p>
            </div>
          )}
          {error && (
            <p className="text-sm text-red-300 bg-red-500/20 border border-red-500/40 px-3 py-2 rounded-xl">
              {error}
            </p>
          )}
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={handleNext}
              disabled={loading}
              className="btn-gradient rounded-xl px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Getting feedback…" : "Next"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // —— Steps 1–3: Sections ——
  if (isInSections && section && sectionIntro) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-100">Design Intake Assistant</h1>
            <p className="text-slate-400 text-sm mt-1">
              Step {currentStep + 1} of 3 — {sectionIntro.heading}
            </p>
            <div className="mt-2 h-2 rounded-full overflow-hidden bg-slate-700/60">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 transition-all duration-300"
                style={{ width: `${(progressStep / 3) * 100}%` }}
              />
            </div>
          </div>
          <button type="button" onClick={resetWizard} className="btn-ghost shrink-0">
            Reset
          </button>
        </div>

        <div className="glass-card p-6 space-y-4 shadow-2xl shadow-slate-900/50">
          {section === "Objectives and Outcomes" && openingResponse.trim() && (
            <>
              <p className="text-slate-400 text-sm font-medium">So far you&apos;ve shared:</p>
              <div className="rounded-xl border border-slate-500/40 bg-slate-800/40 px-4 py-3 text-slate-200 text-sm whitespace-pre-wrap">
                {openingResponse.trim()}
              </div>
              <p className="text-slate-300 text-sm">
                Based on that, let&apos;s define your objectives and outcomes. What do you want to achieve, and what does success look like? Please be specific — we may ask you to add more detail if anything is unclear.
              </p>
            </>
          )}
          {section === "Constraints and Considerations" &&
            (openingResponse.trim() || sectionValues["Objectives and Outcomes"]?.trim()) && (
            <>
              <p className="text-slate-400 text-sm font-medium">So far we have:</p>
              <div className="space-y-2 text-sm">
                {openingResponse.trim() && (
                  <div className="rounded-xl border border-slate-500/40 bg-slate-800/40 px-4 py-2 text-slate-200">
                    <span className="text-slate-500 font-medium">Basics: </span>
                    <span className="whitespace-pre-wrap">{openingResponse.trim().slice(0, 150)}
                      {openingResponse.trim().length > 150 ? "…" : ""}</span>
                  </div>
                )}
                {sectionValues["Objectives and Outcomes"]?.trim() && (
                  <div className="rounded-xl border border-slate-500/40 bg-slate-800/40 px-4 py-2 text-slate-200">
                    <span className="text-slate-500 font-medium">Objectives & outcomes: </span>
                    <span className="whitespace-pre-wrap">{sectionValues["Objectives and Outcomes"].trim().slice(0, 200)}
                      {sectionValues["Objectives and Outcomes"].trim().length > 200 ? "…" : ""}</span>
                  </div>
                )}
              </div>
              {followUpLoading && (
                <p className="text-slate-400 text-sm">Generating follow-up questions based on what you shared…</p>
              )}
              {!followUpLoading && followUpForConstraints && (
                <>
                  <p className="text-slate-300 text-sm mt-2">{followUpForConstraints.intro}</p>
                  <p className="text-slate-400 text-sm font-medium mt-2">Could you share a bit more about:</p>
                </>
              )}
              {!followUpLoading && !followUpForConstraints && followUpError && (
                <>
                  <p className="text-slate-300 text-sm mt-2">{sectionIntro?.intro}</p>
                  <p className="text-slate-500 text-xs mt-1">{followUpError}</p>
                </>
              )}
              {!followUpLoading && !followUpForConstraints && !followUpError && (
                <p className="text-slate-300 text-sm mt-2">
                  Last, clarify any constraints: technical limits, operational realities, scale, or workflow dependencies.
                </p>
              )}
            </>
          )}
          {!(section === "Objectives and Outcomes" && openingResponse.trim()) &&
            !(section === "Constraints and Considerations" &&
              (openingResponse.trim() || sectionValues["Objectives and Outcomes"]?.trim())) && (
            <p className="text-slate-300 text-sm">{sectionIntro.intro}</p>
          )}
          <ul className="list-disc list-inside space-y-1 pl-1 text-slate-400 text-sm">
            {section === "Constraints and Considerations" && followUpLoading
              ? null
              : section === "Constraints and Considerations" && followUpForConstraints
                ? followUpForConstraints.questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))
                : sectionIntro.prompts.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
          </ul>
          <div>
            <label htmlFor="section-input" className="sr-only">
              Your response
            </label>
            <textarea
              id="section-input"
              value={sectionValues[section]}
              onChange={(e) =>
                setSectionValues((prev) => ({ ...prev, [section]: e.target.value }))
              }
              placeholder={section === "Objectives and Outcomes" ? "e.g. Reduce time to complete claims by 30%; improve field rep satisfaction; align with Q2 rollout." : "Share what you know..."}
              rows={12}
              className="w-full rounded-xl border border-slate-500/50 bg-slate-800/50 px-3 py-2 text-slate-100 placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none focus:ring-2 focus:ring-cyan-400/30 disabled:opacity-60"
              disabled={loading}
            />
            {section === "Objectives and Outcomes" && (
              <p className="mt-2 text-xs text-slate-500">
                Be as specific as you can. If something is unclear, we&apos;ll ask you to add more detail before moving on.
              </p>
            )}
          </div>

          {sectionFeedback && (
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 space-y-2">
              {sectionFeedback.openaiError && (
                <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  <span className="font-medium">OpenAI unavailable (showing placeholder):</span>{" "}
                  {sectionFeedback.openaiError}
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-cyan-200">Feedback</p>
                {sectionFeedback.source === "openai" && (
                  <span className="text-[10px] font-medium uppercase tracking-wider text-cyan-400/90 bg-cyan-500/20 px-2 py-0.5 rounded">
                    AI
                  </span>
                )}
              </div>
              <p className="text-sm text-cyan-100/90">{sectionFeedback.feedback}</p>
              {sectionFeedback.suggestedImprovements.length > 0 && (
                <>
                  <p className="text-sm font-medium text-cyan-200 mt-2">Suggested improvements</p>
                  <ul className="list-disc list-inside text-sm text-cyan-100/80 space-y-1">
                    {sectionFeedback.suggestedImprovements.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </>
              )}
              <p className="text-xs text-cyan-200/70 mt-2">
                Risk delta: +{sectionFeedback.riskDelta} → Cumulative: {cumulativeRisk}
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-300 bg-red-500/20 border border-red-500/40 px-3 py-2 rounded-xl">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between pt-2">
            <span className="text-sm text-slate-500">
              Cumulative risk: <strong className="text-slate-300">{cumulativeRisk}</strong>/100
              {allFlags.length > 0 && (
                <span className="ml-2 text-cyan-400">Flags: {allFlags.join(", ")}</span>
              )}
            </span>
            <button
              type="button"
              onClick={handleNext}
              disabled={loading || (!sectionValues[section]?.trim() && !sectionFeedback)}
              className="btn-gradient rounded-xl px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Evaluating..." : sectionFeedback ? (currentStep === STEP_LAST_SECTION ? "Continue to summary" : "Next") : "Next"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // —— Step 4: AI Summary ——
  if (currentStep === STEP_SUMMARY) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold text-slate-100">Design Request Summary</h1>
          <button type="button" onClick={resetWizard} className="btn-ghost shrink-0">
            Reset
          </button>
        </div>
        <div className="glass-card p-6 space-y-6 shadow-2xl shadow-slate-900/50">
          {summaryLoading && (
            <p className="text-slate-400">Generating structured summary...</p>
          )}
          {summaryError && (
            <p className="text-sm text-red-300 bg-red-500/20 border border-red-500/40 px-3 py-2 rounded-xl">
              {summaryError}
            </p>
          )}
          {designRequestSummary && !summaryLoading && (
            <>
              <p className="text-slate-400 text-sm">
                Once sufficient clarity is gathered, here is your structured summary. Review and continue to optionally request a visual concept.
              </p>
              <dl className="space-y-4 text-sm">
                <div>
                  <dt className="font-medium text-slate-500">Problem</dt>
                  <dd className="mt-1 text-slate-200 whitespace-pre-wrap">{designRequestSummary.problem}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Desired Outcome</dt>
                  <dd className="mt-1 text-slate-200 whitespace-pre-wrap">{designRequestSummary.desiredOutcome}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Users Impacted</dt>
                  <dd className="mt-1 text-slate-200 whitespace-pre-wrap">{designRequestSummary.usersImpacted}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Business Value</dt>
                  <dd className="mt-1 text-slate-200 whitespace-pre-wrap">{designRequestSummary.businessValue}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Constraints</dt>
                  <dd className="mt-1 text-slate-200 whitespace-pre-wrap">{designRequestSummary.constraints}</dd>
                </div>
              </dl>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setCurrentStep(STEP_OFFER_VISUAL)}
                  className="btn-gradient rounded-xl px-4 py-2 text-sm"
                >
                  Next
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // —— Step 5: Offer Visual Mockup ——
  if (currentStep === STEP_OFFER_VISUAL) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="glass-card p-8 space-y-6 shadow-2xl shadow-slate-900/50">
          <h2 className="text-xl font-bold text-slate-100">
            Would you like me to create a quick visual concept to support this request?
          </h2>
          <p className="text-slate-400 text-sm">
            This is optional — you’re in control. If you’d like, I can generate a visual mockup based on your summary to help align the team. If you prefer to skip it, we’ll go straight to your final summary.
          </p>
          <div className="flex flex-wrap gap-4 pt-2">
            <button
              type="button"
              onClick={() => handleOfferVisual(true)}
              className="btn-gradient rounded-xl px-5 py-2.5 text-sm"
            >
              Yes, create a visual concept
            </button>
            <button
              type="button"
              onClick={() => handleOfferVisual(false)}
              className="rounded-xl border border-slate-500/50 bg-slate-800/40 px-5 py-2.5 text-sm text-slate-300 hover:bg-slate-700/50 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
            >
              No, skip to final summary
            </button>
          </div>
        </div>
      </div>
    );
  }

  // —— Step 6: Visual Concept (generating or shown) ——
  if (currentStep === STEP_VISUAL_CONCEPT) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold text-slate-100">Reference Concept (Low Fidelity UX Direction)</h1>
          <button type="button" onClick={resetWizard} className="btn-ghost shrink-0">
            Reset
          </button>
        </div>
        <div className="glass-card p-6 space-y-6 shadow-2xl shadow-slate-900/50">
          {conceptLoading && (
            <p className="text-slate-400">Generating visual concept...</p>
          )}
          {conceptError && (
            <p className="text-sm text-red-300 bg-red-500/20 border border-red-500/40 px-3 py-2 rounded-xl">
              {conceptError}
            </p>
          )}
          {mockupLoading && (
            <p className="text-slate-400">Generating mockup image…</p>
          )}
          {mockupError && (
            <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/40 px-3 py-2 rounded-xl">
              Error generating mockup: {mockupError}
            </p>
          )}
          {mockupImage && (
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-2">Visual mockup</h3>
              <img
                src={mockupImage}
                alt="Generated design request mockup"
                className="w-full rounded-xl border border-slate-600/50 bg-slate-800/30 max-h-[480px] object-contain"
              />
            </div>
          )}
          {referenceConcept && !conceptLoading && (
            <>
              <p className="text-slate-400 text-sm">
                Reference concept (generated text) — a thinking aid to accelerate alignment, not a final design.
              </p>
              <dl className="space-y-4 text-sm">
                <div>
                  <dt className="font-medium text-slate-500">Experience Goal</dt>
                  <dd className="mt-1 text-slate-200 whitespace-pre-wrap">{referenceConcept.experienceGoal}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Suggested Layout</dt>
                  <dd className="mt-1 text-slate-200 whitespace-pre-wrap">{referenceConcept.suggestedLayout}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Key Elements</dt>
                  <dd className="mt-1 text-slate-200 whitespace-pre-wrap">{referenceConcept.keyElements}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Interaction Model</dt>
                  <dd className="mt-1 text-slate-200 whitespace-pre-wrap">{referenceConcept.interactionModel}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Design Considerations</dt>
                  <dd className="mt-1 text-slate-200 whitespace-pre-wrap">{referenceConcept.designConsiderations}</dd>
                </div>
              </dl>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setCurrentStep(STEP_FINAL)}
                  className="btn-gradient rounded-xl px-4 py-2 text-sm"
                >
                  Continue to final submission
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // —— Step 7: Final (submitted) ——
  if (currentStep === STEP_FINAL) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-8">
        <section className="glass-card p-6 shadow-2xl shadow-slate-900/50">
          <h2 className="text-xl font-semibold text-slate-100 mb-2">Thank you</h2>
          <p className="text-slate-400 mb-6">
            Your design request has been captured. Our UX team will review it and reach out if needed.
          </p>

          {/* 1. Reference Concept (generated text) */}
          {(referenceConcept || conceptLoading) && (
            <>
              <h3 className="font-semibold text-slate-100 mb-2">Reference concept</h3>
              <p className="text-slate-500 text-xs mb-3">Generated text summary — low-fidelity UX direction</p>
              {conceptLoading && (
                <p className="text-slate-400 text-sm">Generating reference concept…</p>
              )}
              {referenceConcept && !conceptLoading && (
                <dl className="space-y-4 text-sm mb-6">
                  <div>
                    <dt className="font-medium text-slate-500">Experience Goal</dt>
                    <dd className="mt-1 text-slate-200 whitespace-pre-wrap">{referenceConcept.experienceGoal}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Suggested Layout</dt>
                    <dd className="mt-1 text-slate-200 whitespace-pre-wrap">{referenceConcept.suggestedLayout}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Key Elements</dt>
                    <dd className="mt-1 text-slate-200 whitespace-pre-wrap">{referenceConcept.keyElements}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Interaction Model</dt>
                    <dd className="mt-1 text-slate-200 whitespace-pre-wrap">{referenceConcept.interactionModel}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Design Considerations</dt>
                    <dd className="mt-1 text-slate-200 whitespace-pre-wrap">{referenceConcept.designConsiderations}</dd>
                  </div>
                </dl>
              )}
            </>
          )}

          {/* 2. Visual mockup (if generated) */}
          {mockupImage && (
            <>
              <h3 className="font-semibold text-slate-100 mb-2 mt-6">Visual mockup</h3>
              <p className="text-slate-500 text-xs mb-3">Generated image based on your request</p>
              <img
                src={mockupImage}
                alt="Generated design request mockup"
                className="w-full rounded-xl border border-slate-600/50 bg-slate-800/30 max-h-[480px] object-contain"
              />
            </>
          )}

          {/* 3. Structured summary ready for submission */}
          <h3 className="font-semibold text-slate-100 mb-3 mt-8">Structured summary — ready for submission</h3>
          {designRequestSummary && (
            <dl className="space-y-4 text-sm mb-6">
              <div>
                <dt className="font-medium text-slate-500">Problem</dt>
                <dd className="mt-1 text-slate-200 whitespace-pre-wrap">{designRequestSummary.problem}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Desired Outcome</dt>
                <dd className="mt-1 text-slate-200 whitespace-pre-wrap">{designRequestSummary.desiredOutcome}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Users Impacted</dt>
                <dd className="mt-1 text-slate-200 whitespace-pre-wrap">{designRequestSummary.usersImpacted}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Business Value</dt>
                <dd className="mt-1 text-slate-200 whitespace-pre-wrap">{designRequestSummary.businessValue}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Constraints</dt>
                <dd className="mt-1 text-slate-200 whitespace-pre-wrap">{designRequestSummary.constraints}</dd>
              </div>
            </dl>
          )}

          <div className="flex items-center gap-4 flex-wrap mt-8 pt-6 border-t border-slate-600/50">
            <button
              type="button"
              onClick={() => setShowUxView(!showUxView)}
              className="text-sm text-slate-500 hover:text-cyan-400 underline transition-colors"
            >
              {showUxView ? "Hide" : "Show"} UX internal view
            </button>
            <button
              type="button"
              onClick={resetWizard}
              className="text-sm text-slate-500 hover:text-cyan-400 underline transition-colors"
            >
              Start over
            </button>
          </div>

          {showUxView && (
            <div className="mt-6 p-4 rounded-xl border border-slate-600/50 bg-slate-900/80 space-y-4">
              <h3 className="font-semibold text-slate-100">UX internal view</h3>
              <p className="text-sm text-slate-400">
                Risk score: <strong className="text-slate-300">{summary.risk_score}</strong>/100 · Recommended action:{" "}
                <strong className="text-slate-300">{recommendedAction}</strong>
              </p>
              {summary.flags.length > 0 && (
                <p className="text-sm text-slate-400">Flags: {summary.flags.join(", ")}</p>
              )}
              <pre className="p-4 rounded-xl bg-slate-950/80 border border-slate-700 text-slate-300 text-xs overflow-x-auto max-h-80">
                {JSON.stringify(
                  {
                    designRequestSummary: summary.designRequestSummary,
                    referenceConcept: summary.referenceConcept,
                    risk_score: summary.risk_score,
                    flags: summary.flags,
                    recommendedAction,
                  },
                  null,
                  2
                )}
              </pre>
            </div>
          )}
        </section>
      </div>
    );
  }

  return null;
}
