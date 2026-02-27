/** Main content sections the user fills in (conversational guidance) */
export const SECTIONS = [
  "Objectives and Outcomes",
  "Constraints and Considerations",
] as const;

export type SectionKey = (typeof SECTIONS)[number];

/** Includes Opening for the first step evaluation */
export type AnySectionKey = SectionKey | "Opening";

export type RiskFlag =
  | "Solution Bias"
  | "Missing Metrics"
  | "Strategic Misalignment"
  | "Dependency Risk"
  | string;

export interface SectionFeedback {
  section: AnySectionKey;
  feedback: string;
  suggestedImprovements: string[];
  riskDelta: number;
  flags: RiskFlag[];
  source?: "openai" | "placeholder";
  openaiError?: string;
}

/** Structured summary generated after gathering clarity (AI Summary step) */
export interface DesignRequestSummary {
  problem: string;
  desiredOutcome: string;
  usersImpacted: string;
  businessValue: string;
  constraints: string;
}

/** Low-fidelity UX direction (Reference Concept) when user opts in */
export interface ReferenceConcept {
  experienceGoal: string;
  suggestedLayout: string;
  keyElements: string;
  interactionModel: string;
  designConsiderations: string;
}

export interface IntakeSummary {
  problem_statement: string;
  desired_outcome: string;
  risk_score: number;
  flags: RiskFlag[];
  product_pillar?: string;
  quarter_slated_for?: string;
  supporting_documents?: string[];
  /** When available from AI Summary step */
  designRequestSummary?: DesignRequestSummary;
  /** When user requested visual concept */
  referenceConcept?: ReferenceConcept;
}

export type RecommendedAction =
  | "Backlog Ready"
  | "Clarification Call Recommended"
  | "Strategic Review Required";
