import { describe, it, expect } from "vitest";
import { detectRedFlags, getRedFlagPriority } from "../../shared/triage-rules";
import { analyzeClinicalTriage, validateClinicalTriageResult } from "../../shared/clinical-triage";

describe("Red Flag Detection - Emergency Symptoms", () => {
  it("detects chest pain as emergency", () => {
    const result = detectRedFlags("Patient complaining of severe chest pain");
    expect(result.detected).toBe(true);
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0].id).toBe("cardio_chest_pain");
    expect(result.flags[0].severity).toBe("emergency");
    expect(result.requiresHumanReview).toBe(true);
  });

  it("detects difficulty breathing as emergency", () => {
    const result = detectRedFlags("Patient has difficulty breathing");
    expect(result.detected).toBe(true);
    expect(result.flags[0].id).toBe("resp_diff_breathing");
    expect(result.requiresHumanReview).toBe(true);
  });

  it("detects altered consciousness as emergency", () => {
    const result = detectRedFlags("Patient is unconscious and unresponsive");
    expect(result.detected).toBe(true);
    expect(result.flags[0].id).toBe("neuro_altered_consciousness");
    expect(result.requiresHumanReview).toBe(true);
  });

  it("detects severe bleeding as emergency", () => {
    const result = detectRedFlags("Patient experiencing severe bleeding");
    expect(result.detected).toBe(true);
    expect(result.flags[0].id).toBe("cardio_severe_bleeding");
    expect(result.requiresHumanReview).toBe(true);
  });

  it("detects low oxygen saturation as emergency", () => {
    const result = detectRedFlags("Patient feeling unwell", {
      vitalSigns: { oxygenSaturation: 85 },
    });
    expect(result.detected).toBe(true);
    expect(result.flags[0].id).toBe("resp_low_o2");
    expect(result.requiresHumanReview).toBe(true);
  });

  it("uses explicitly supplied rule configuration", () => {
    const configuredThreshold = detectRedFlags("Patient feels unwell", {
      vitalSigns: { oxygenSaturation: 85 },
    }, { oxygenSaturationEmergencyBelow: 80 });
    const disabledRule = detectRedFlags("Patient has chest pain", undefined, {
      disabledRuleIds: ["cardio_chest_pain"],
    });
    expect(configuredThreshold.detected).toBe(false);
    expect(disabledRule.detected).toBe(false);
  });
});

describe("Red Flag Detection - Negation Handling", () => {
  it("does NOT flag 'no chest pain'", () => {
    const result = detectRedFlags("Patient denies chest pain");
    expect(result.detected).toBe(false);
    expect(result.flags).toHaveLength(0);
  });

  it("does NOT flag 'not having difficulty breathing'", () => {
    const result = detectRedFlags("Patient is not having difficulty breathing");
    expect(result.detected).toBe(false);
  });

  it("does NOT flag 'without bleeding'", () => {
    const result = detectRedFlags("Patient presents without bleeding");
    expect(result.detected).toBe(false);
  });

  it("does NOT flag 'negative for seizures'", () => {
    const result = detectRedFlags("Examination negative for seizures");
    expect(result.detected).toBe(false);
  });

  it("does NOT flag 'patient is conscious'", () => {
    const result = detectRedFlags("Patient is conscious and alert");
    expect(result.detected).toBe(false);
  });

  it("keeps independently negated symptoms negated", () => {
    const result = detectRedFlags("Patient has no chest pain and no difficulty breathing");
    expect(result.detected).toBe(false);
  });

  it("handles double negatives correctly", () => {
    const result = detectRedFlags("Patient has not been without chest pain");
    expect(result.detected).toBe(true);
    expect(result.requiresHumanReview).toBe(true);
    expect(result.uncertainties).toContain("Double-negative wording requires clarification.");
  });

  it("detects an affirmed symptom after a negated earlier mention", () => {
    const result = detectRedFlags("No chest pain earlier; now chest pain");
    expect(result.flags.some((flag) => flag.id === "cardio_chest_pain")).toBe(true);
    expect(result.requiresHumanReview).toBe(true);
  });
});

describe("Red Flag Detection - Spelling Variations", () => {
  it("handles UK spelling 'labour' vs US 'labor'", () => {
    const result1 = detectRedFlags("Pregnant woman in prolonged labour", { isPregnant: true });
    const result2 = detectRedFlags("Pregnant woman in prolonged labor", { isPregnant: true });
    
    expect(result1.detected).toBe(true);
    expect(result2.detected).toBe(true);
    expect(result1.flags[0].id).toBe(result2.flags[0].id);
  });

  it("handles alternative breathing difficulty phrases", () => {
    const phrases = [
      "difficulty breathing",
      "shortness of breath",
      "breathlessness",
      "dyspnea",
      "cant breathe",
      "gasping",
    ];

    phrases.forEach((phrase) => {
      const result = detectRedFlags(`Patient experiencing ${phrase}`);
      expect(result.detected).toBe(true);
      expect(result.flags[0].id).toBe("resp_diff_breathing");
    });
  });

  it("normalizes common misspellings without matching partial substrings", () => {
    expect(detectRedFlags("Patient has chset pain and brething difficulty").detected).toBe(true);
    expect(detectRedFlags("The word unbreathingish appears in a note").detected).toBe(false);
  });
});

describe("Red Flag Detection - Pediatric Cases", () => {
  it("detects pediatric unable to feed (with age)", () => {
    const result = detectRedFlags("Infant unable to breastfeed", { age: 0.5 });
    expect(result.detected).toBe(true);
    expect(result.flags[0].id).toBe("peds_unable_feed");
    expect(result.requiresHumanReview).toBe(true);
  });

  it("detects pediatric convulsions from text keywords", () => {
    const result = detectRedFlags("Child having seizure episode");
    expect(result.detected).toBe(true);
    expect(result.flags.some((f) => f.id === "peds_convulsions")).toBe(true);
  });

  it("does NOT apply pediatric rules to adults", () => {
    const result = detectRedFlags("Patient unable to drink", { age: 45 });
    expect(result.flags.some((f) => f.id === "peds_unable_feed")).toBe(false);
  });

  it("detects abnormally sleepy child", () => {
    const result = detectRedFlags("Toddler is abnormally sleepy and difficult to wake");
    expect(result.detected).toBe(true);
    expect(result.flags.some((f) => f.id === "peds_abnormally_sleepy")).toBe(true);
  });
});

describe("Red Flag Detection - Obstetric Cases", () => {
  it("detects vaginal bleeding in pregnancy", () => {
    const result = detectRedFlags("Pregnant woman with vaginal bleeding", {
      isPregnant: true,
    });
    expect(result.detected).toBe(true);
    expect(result.flags[0].id).toBe("obs_bleeding_pregnancy");
    expect(result.requiresHumanReview).toBe(true);
  });

  it("detects pre-eclampsia signs", () => {
    const result = detectRedFlags("Pregnant woman with severe headache and blurred vision", {
      isPregnant: true,
    });
    expect(result.detected).toBe(true);
    expect(result.flags[0].id).toBe("obs_severe_preeclampsia");
  });

  it("does NOT apply obstetric rules to non-pregnant patients", () => {
    const result = detectRedFlags("Woman with vaginal bleeding", {
      isPregnant: false,
    });
    expect(result.flags.some((f) => f.id === "obs_bleeding_pregnancy")).toBe(false);
  });

  it("preserves a pregnancy red flag and marks conflicting context for review", () => {
    const result = detectRedFlags("Pregnant patient with vaginal bleeding", { isPregnant: false });
    expect(result.flags.some((f) => f.id === "obs_bleeding_pregnancy")).toBe(true);
    expect(result.requiresHumanReview).toBe(true);
    expect(result.uncertainties).toContain(
      "Pregnancy status conflicts between the report and structured context.",
    );
  });

  it("detects water breaking", () => {
    const result = detectRedFlags("Pregnant woman reports water broke", {
      isPregnant: true,
    });
    expect(result.detected).toBe(true);
    expect(result.flags[0].id).toBe("obs_premature_rupture");
  });
});

describe("Red Flag Detection - Vague/Missing Symptoms", () => {
  it("returns no flags for vague symptoms", () => {
    const vaguePhrases = [
      "not feeling well",
      "feeling sick",
      "general malaise",
      "unwell",
      "feeling tired",
    ];

    vaguePhrases.forEach((phrase) => {
      const result = detectRedFlags(phrase);
      expect(result.detected).toBe(false);
      expect(result.flags).toHaveLength(0);
    });
  });

  it("returns no flags for empty input", () => {
    const result = detectRedFlags("");
    expect(result.detected).toBe(false);
    expect(result.flags).toHaveLength(0);
  });

  it("returns no flags for whitespace-only input", () => {
    const result = detectRedFlags("   ");
    expect(result.detected).toBe(false);
  });

  it("marks vague or missing reports as uncertain and requiring review", () => {
    const vague = analyzeClinicalTriage("Maybe feeling unwell");
    const missing = analyzeClinicalTriage("");
    expect(vague.urgency).toBe("undetermined");
    expect(vague.requiresHumanReview).toBe(true);
    expect(vague.uncertainty.level).toBe("high");
    expect(missing.missingInformation).toContain("Current symptoms and their onset");
  });
});

describe("Red Flag Detection - Contradictory Inputs", () => {
  it("handles mixed positive and negative symptoms", () => {
    const result = detectRedFlags(
      "Patient has chest pain but no difficulty breathing and is conscious"
    );
    expect(result.detected).toBe(true);
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0].id).toBe("cardio_chest_pain");
  });

  it("marks ambiguous and contradictory inputs for clinician review", () => {
    const ambiguous = detectRedFlags("Possibly having chest pain");
    const contradictory = detectRedFlags("Denies chest pain, but now chest pain");
    expect(ambiguous.requiresHumanReview).toBe(true);
    expect(ambiguous.uncertainties).not.toHaveLength(0);
    expect(contradictory.detected).toBe(true);
    expect(contradictory.requiresHumanReview).toBe(true);
  });

  it("prioritizes emergency flags over non-flags", () => {
    const result = detectRedFlags(
      "Patient feeling generally unwell but also experiencing severe bleeding"
    );
    expect(result.detected).toBe(true);
    expect(result.flags[0].id).toBe("cardio_severe_bleeding");
  });
});

describe("Red Flag Detection - Multiple Flags", () => {
  it("detects multiple emergency flags", () => {
    const result = detectRedFlags(
      "Patient has chest pain, difficulty breathing, and is confused"
    );
    expect(result.detected).toBe(true);
    expect(result.flags.length).toBeGreaterThanOrEqual(3);
    expect(result.requiresHumanReview).toBe(true);
  });

  it("requires human review for 2+ urgent flags", () => {
    const result = detectRedFlags("Severe headache and head injury with brief unconsciousness");
    expect(result.detected).toBe(true);
    const urgentCount = result.flags.filter((f) => f.severity === "urgent").length;
    expect(urgentCount).toBeGreaterThanOrEqual(2);
    expect(result.requiresHumanReview).toBe(true);
  });

  it("deduplicates identical flags from different patterns", () => {
    const result = detectRedFlags(
      "Patient has chest pain, cardiac pain, and angina"
    );
    expect(result.detected).toBe(true);
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0].id).toBe("cardio_chest_pain");
  });
});

describe("Red Flag Priority Mapping", () => {
  it("returns emergency for emergency flags", () => {
    const result = detectRedFlags("Patient has severe chest pain");
    const priority = getRedFlagPriority(result);
    expect(priority).toBe("emergency");
  });

  it("returns urgent for urgent flags only", () => {
    const result = detectRedFlags("Severe headache");
    const priority = getRedFlagPriority(result);
    expect(priority).toBe("urgent");
  });

  it("returns null for no flags", () => {
    const result = detectRedFlags("Patient feeling generally unwell");
    const priority = getRedFlagPriority(result);
    expect(priority).toBe(null);
  });

  it("prioritizes emergency over urgent", () => {
    const result = detectRedFlags("Severe headache and chest pain");
    const priority = getRedFlagPriority(result);
    expect(priority).toBe("emergency");
  });
});

describe("Red Flag Detection - Context Integration", () => {
  it("combines text symptoms with vital signs", () => {
    const result = detectRedFlags("Patient complaining of chest discomfort", {
      vitalSigns: {
        oxygenSaturation: 85,
        heartRate: 140,
      },
    });
    expect(result.detected).toBe(true);
    expect(result.flags.length).toBeGreaterThanOrEqual(2);
    expect(result.flags.some((f) => f.id === "cardio_chest_pain")).toBe(true);
    expect(result.flags.some((f) => f.id === "resp_low_o2")).toBe(true);
  });

  it("uses age context for pediatric rules", () => {
    const result = detectRedFlags("Unable to feed", { age: 0.2 });
    expect(result.detected).toBe(true);
    expect(result.flags[0].id).toBe("peds_unable_feed");
  });

  it("uses pregnancy context for obstetric rules", () => {
    const result = detectRedFlags("Severe headache", { isPregnant: true });
    expect(result.detected).toBe(true);
    expect(result.flags[0].id).toBe("obs_severe_preeclampsia");
  });
});

describe("Red Flag Detection - Edge Cases", () => {
  it("handles very long symptom text", () => {
    const longText = "Patient reports ".repeat(100) + "chest pain";
    const result = detectRedFlags(longText);
    expect(result.detected).toBe(true);
    expect(result.flags[0].id).toBe("cardio_chest_pain");
  });

  describe("Clinical triage output validation", () => {
    it("rejects extra fields and invalid urgency values at runtime", () => {
      const valid = analyzeClinicalTriage("Chest pain");
      expect(() => validateClinicalTriageResult({ ...valid, diagnosis: "invented" })).toThrow();
      expect(() => validateClinicalTriageResult({ ...valid, urgency: "diagnosed" })).toThrow();
    });
  });

  it("handles special characters and punctuation", () => {
    const result = detectRedFlags("Patient has: chest pain!!! severe...");
    expect(result.detected).toBe(true);
    expect(result.flags[0].id).toBe("cardio_chest_pain");
  });

  it("handles mixed case text", () => {
    const result = detectRedFlags("PATIENT HAS CHEST PAIN");
    expect(result.detected).toBe(true);
  });

  it("handles non-English characters gracefully", () => {
    const result = detectRedFlags("रोगी को सीने में दर्द है chest pain");
    expect(result.detected).toBe(true);
  });
});
