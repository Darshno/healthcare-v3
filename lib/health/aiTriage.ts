import type { Priority, PriorityReason } from "./types";
import type { DoctorSpecialization, UserProfile, DoctorProfile } from "./userAuth";
import { analyzeClinicalTriage, type ClinicalTriageResult } from "../../shared/clinical-triage";
import { detectRedFlags } from "../../shared/triage-rules";

export { analyzeClinicalTriage };
export type { ClinicalTriageResult };

export type TriageAnalysisResult = {
  priority: Priority;
  priorityReason: PriorityReason;
  recommendedSpecialization: DoctorSpecialization;
  clinicalSummary: string;
  matchedDoctor: {
    id: string;
    name: string;
    specialization: string;
  } | null;
};

function normalizeLegacyText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/labour/g, "labor")
    .replace(/[^a-z0-9\s.,;!?-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasPositivePhrase(text: string, phrases: string[]): boolean {
  const normalized = normalizeLegacyText(text);
  return phrases.some((phrase) => {
    const escaped = normalizeLegacyText(phrase)
      .split(/\s+/)
      .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\s-]+");
    const expression = new RegExp(`(^|[\\s.,;!?])${escaped}(?=$|[\\s.,;!?])`, "g");
    let match: RegExpExecArray | null;
    while ((match = expression.exec(normalized)) !== null) {
      const beforeMatch = normalized
        .slice(0, match.index)
        .split(/[.!?;,\n]|\bbut\b|\bhowever\b|\band\b/);
      const recentWords = (beforeMatch[beforeMatch.length - 1] ?? "").trim().split(/\s+/).slice(-6);
      if (!/\b(?:no|not|denies?|without|absent|negative\s+for)\b/.test(recentWords.join(" "))) {
        return true;
      }
    }
    return false;
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Keyword & Clinical Rule Engine for Offline Triage & Specialty Assignment
// ──────────────────────────────────────────────────────────────────────────────

export function analyzeDiseaseRuleBased(
  diseaseText: string,
  context?: Parameters<typeof analyzeClinicalTriage>[1],
): {
  priority: Priority;
  priorityReason: PriorityReason;
  recommendedSpecialization: DoctorSpecialization;
  clinicalSummary: string;
} {
  const text = typeof diseaseText === "string" ? diseaseText : "";
  const containsPhrase = (phrases: string[]) => hasPositivePhrase(text, phrases);
  const pregnancyReported = containsPhrase(["pregnant", "pregnancy", "maternal", "trimester"]);
  const maternalReported =
    pregnancyReported || containsPhrase(["labor", "labour", "delivery"]);
  const pediatricReported = containsPhrase(["child", "infant", "baby", "pediatric", "paediatric", "toddler", "newborn"]);
  const flags = detectRedFlags(text, {
    ...context,
    ...(maternalReported ? { isPregnant: true } : {}),
  }).flags;

  if (flags.some((flag) => flag.severity === "emergency")) {
    const specialty = flags.some((flag) => flag.category === "obstetric")
      ? "Obstetrics & Gynecology"
      : flags.some((flag) => flag.category === "pediatric")
        ? "Pediatrics / Child Health"
        : flags.some((flag) => flag.category === "trauma")
          ? "Emergency & Trauma Care"
          : "Emergency & Trauma Care";
    return {
      priority: "emergency",
      priorityReason: "vitalConcern",
      recommendedSpecialization: specialty,
      clinicalSummary: "A configured red-flag indicator was detected; seek immediate clinician assessment.",
    };
  }

  if (maternalReported) {
    return {
      priority: "urgent",
      priorityReason: "maternalDanger",
      recommendedSpecialization: "Obstetrics & Gynecology",
      clinicalSummary: "Maternal-care assessment is recommended; a clinician must determine urgency.",
    };
  }

  if (pediatricReported) {
    return {
      priority: "urgent",
      priorityReason: "childDanger",
      recommendedSpecialization: "Pediatrics / Child Health",
      clinicalSummary: "Pediatric-care assessment is recommended; a clinician must determine urgency.",
    };
  }

  if (containsPhrase(["fracture", "wound", "burn", "cut", "accident", "injury", "swallowing"])) {
    return {
      priority: "urgent",
      priorityReason: "clinicianUrgent",
      recommendedSpecialization: "General Surgery",
      clinicalSummary: "Injury-related clinician assessment is recommended.",
    };
  }

  if (containsPhrase(["tooth", "teeth", "dental", "gum"])) {
    return {
      priority: "routine",
      priorityReason: "routineCare",
      recommendedSpecialization: "Dental & Oral Health",
      clinicalSummary: "Dental assessment is recommended; urgency has not been clinically determined.",
    };
  }

  if (containsPhrase(["diabetes", "bp", "hypertension", "blood pressure", "chronic", "asthma"])) {
    return {
      priority: "priority",
      priorityReason: "chronicReview",
      recommendedSpecialization: "General Medicine (MBBS)",
      clinicalSummary: "A clinician review is recommended for the reported ongoing condition.",
    };
  }

  if (containsPhrase(["fever", "cough", "cold", "infection", "vomit", "diarrhea", "diarrhoea", "headache", "pain"])) {
    return {
      priority: "urgent",
      priorityReason: "vitalConcern",
      recommendedSpecialization: "Community Medicine / MO",
      clinicalSummary: "Prompt clinician assessment is recommended; urgency needs clinical confirmation.",
    };
  }

  return {
    priority: "routine",
    priorityReason: "routineCare",
    recommendedSpecialization: "General Medicine (MBBS)",
    clinicalSummary: "No configured red-flag indicator was identified; clinician review remains necessary.",
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Compatibility API retained for current callers; all provider calls are server-only.
// ──────────────────────────────────────────────────────────────────────────────

export async function analyzeDiseaseWithGemini(diseaseText: string): Promise<{
  priority: Priority;
  priorityReason: PriorityReason;
  recommendedSpecialization: DoctorSpecialization;
  clinicalSummary: string;
}> {
  // Keep this client-side compatibility API offline-only. Provider calls belong on
  // the backend, where credentials and strict response validation can be enforced.
  const ruleBaseline = analyzeDiseaseRuleBased(diseaseText);
  return ruleBaseline;
}


// ──────────────────────────────────────────────────────────────────────────────
// Local directory recommendation; this does not confirm clinician availability.
// ──────────────────────────────────────────────────────────────────────────────

export function matchBestDoctor(
  facilityId: string,
  recommendedSpecialty: DoctorSpecialization,
  registeredUsers: UserProfile[],
  currentQueue: { doctorName?: string; doctorId?: string; status: string }[] = []
): { id: string; name: string; specialization: string } | null {
  if (!facilityId.trim()) return null;

  // Find all doctors registered for this facility
  const facilityDoctors = registeredUsers.filter(
    (u) =>
      (u.role === "doctor" || u.role === "chief_doctor") &&
      u.facilityId === facilityId
  ) as DoctorProfile[];

  if (facilityDoctors.length === 0) {
    return null;
  }

  // Count active queue items per doctor
  const doctorLoad = new Map<string, number>();
  facilityDoctors.forEach((doc) => doctorLoad.set(doc.id, 0));

  currentQueue.forEach((q) => {
    if (q.status !== "completed" && q.doctorId && doctorLoad.has(q.doctorId)) {
      doctorLoad.set(q.doctorId, (doctorLoad.get(q.doctorId) || 0) + 1);
    }
  });

  // Recommend only a real directory entry. Queue load is a routing hint, not
  // evidence that a clinician is currently available or an appointment is booked.
  const specialtyMatches = facilityDoctors.filter((doc) =>
    doc.specialization.toLowerCase().includes(recommendedSpecialty.toLowerCase())
  );

  if (specialtyMatches.length > 0) {
    // Prefer a matching specialty with the lower recorded queue count.
    specialtyMatches.sort(
      (a, b) => (doctorLoad.get(a.id) || 0) - (doctorLoad.get(b.id) || 0)
    );
    const chosen = specialtyMatches[0];
    return {
      id: chosen.id,
      name: chosen.name,
      specialization: chosen.specialization,
    };
  }

  // Otherwise return a real facility clinician as a routing recommendation.
  facilityDoctors.sort(
    (a, b) => (doctorLoad.get(a.id) || 0) - (doctorLoad.get(b.id) || 0)
  );
  const freestDoctor = facilityDoctors[0];

  return {
    id: freestDoctor.id,
    name: freestDoctor.name,
    specialization: freestDoctor.specialization,
  };
}
