# UX Intake Form

A multi-step guided UX intake form built with **Next.js 14** (App Router) and **Tailwind CSS**.

## Sections (3)

1. Problem Framing  
2. Objectives and Business impact  
3. Supporting Documents (file upload)

Intro collects: name, product pillar, and which quarter the project is slated for (Q1–Q4).  

## Features

- **Wizard UI**: One section at a time; textarea + "Next" to submit each section.
- **Inline coaching**: After each section, the app calls `/api/evaluate-section`, then shows feedback and suggested improvements before allowing continuation.
- **Cumulative risk score** (0–100) and **flags** (e.g. Solution Bias, Missing Metrics, Strategic Misalignment, Dependency Risk) tracked in app state.
- **Final submission**: Thank-you message and optional coaching notes for Product; expandable **UX internal view** with aggregated risk score, all flags, recommended next action (Backlog Ready / Clarification Call Recommended / Strategic Review Required), and structured summary JSON.

## API

- **POST `/api/evaluate-section`**  
  Body: `{ "section": "Problem Framing", "input": "user text" }`  
  Returns: `{ section, feedback, suggestedImprovements, riskDelta, flags }`  

v1 uses **placeholder evaluation logic** (no OpenAI API key). Replace with real OpenAI calls in the route when ready.

## Run

**Use the dev server only** (so you see code changes without rebuilding):

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Edits to the code will recompile automatically; refresh the browser if the page doesn’t update.

Don’t use `npm run start` unless you need to test a production build — it serves a fixed build and won’t show changes until you run `npm run build` again.

## v1 scope

- Functional section-based wizard  
- Inline coaching feedback  
- Cumulative risk score  
- Structured summary output  
- Ready for future Monday.com integration  

Not in v1: memory, analytics dashboard, API key management.
