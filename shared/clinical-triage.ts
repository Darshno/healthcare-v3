import { z } from "zod";
import { detectRedFlags, getRedFlagPriority } from "./triage-rules";

const detectedRedFlagSchema = z
  .object({
    id: z.string().min(1),
    category: z.enum([
      "respiratory",
      "cardiovascular",
      "neurological",
      "obstetric",
      "pediatric",
      "trauma",
    ]),
    severity: z.enum(["emergency", "urgent"]),
    description: z.string().min(1),
  })
  .strict();

const decisionSupportSchema = z
  .object({
    organizedSymptoms: z.array(z.string().min(1).max(120)).max(6),
    followUpQuestions: z.array(z.string().min(1).max(160)).max(6),
  })
  .strict();

export const ClinicalTriageResultSchema = z
  .object({
    urgency: z.enum(["emergency", "urgent", "priority", "routine", "undetermined"]),
    detectedRedFlags: z.array(detectedRedFlagSchema),
    reasons: z.array(z.string().min(1)),
    missingInformation: z.array(z.string().min(1)),
    uncertainty: z
      .object({
        level: z.enum(["low", "moderate", "high"]),
        notes: z.array(z.string().min(1)),
      })
      .strict(),
    recommendedNextAction: z.string().min(1),
    requiresHumanReview: z.boolean(),
    decisionSupport: decisionSupportSchema.optional(),
  })
  .strict();

export type ClinicalTriageResult = z.infer<typeof ClinicalTriageResultSchema>;

export type ClinicalTriageContext = {
  age?: number;
  isPregnant?: boolean;
  vitalSigns?: {
    heartRate?: number;
    systolicBP?: number;
    oxygenSaturation?: number;
    temperature?: number;
  };
};

export function validateClinicalTriageResult(value: unknown): ClinicalTriageResult {
  return ClinicalTriageResultSchema.parse(value);
}

export function analyzeClinicalTriage(
  symptomText: string,
  context?: ClinicalTriageContext,
): ClinicalTriageResult {
  const redFlags = detectRedFlags(symptomText, context);
  const urgency = getRedFlagPriority(redFlags) ?? "undetermined";
  const missingInformation = [
    ...(!symptomText.trim() ? ["Current symptoms and their onset"] : []),
    ...(context?.age === undefined ? ["Patient age"] : []),
    ...(context?.isPregnant === undefined ? ["Pregnancy status, when relevant"] : []),
    ...(context?.vitalSigns === undefined ? ["Vital signs, if available"] : []),
  ];
  const uncertaintyNotes = [
    ...redFlags.uncertainties,
    ...(redFlags.detected
      ? ["Rule-triggered indicators are not a diagnosis and require local clinical validation."]
      : ["No configured red-flag pattern was identified; absence of a flag does not rule out urgent illness."]),
    ...(missingInformation.length > 0
      ? ["Information is incomplete; urgency cannot be determined from the available report alone."]
      : []),
  ];
  const reasons = redFlags.flags.map((flag) => `Reported information matched: ${flag.description}.`);

  return validateClinicalTriageResult({
    urgency,
    detectedRedFlags: redFlags.flags.map(({ id, category, severity, description }) => ({
      id,
      category,
      severity,
      description,
    })),
    reasons: reasons.length > 0 ? reasons : ["No configured red-flag indicator was identified."],
    missingInformation,
    uncertainty: {
      level: redFlags.detected ? "moderate" : "high",
      notes: uncertaintyNotes,
    },
    recommendedNextAction:
      urgency === "emergency"
        ? "Seek immediate emergency assessment; do not wait for AI output."
        : urgency === "urgent"
          ? "Arrange prompt assessment by a qualified clinician."
          : "Collect the missing history and arrange clinician review; do not infer that the patient is low risk.",
    requiresHumanReview: true,
  });
}
