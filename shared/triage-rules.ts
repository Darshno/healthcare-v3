/**
 * Deterministic Red-Flag Rules Engine
 * 
 * These rules provide a transparent, offline-capable indicator layer. They are
 * not a clinically validated protocol and cannot rule out emergencies.
 * 
 * IMPORTANT: Qualified clinicians must approve every rule, its scope, threshold,
 * translations, and local escalation action before clinical use.
 */

export type RedFlag = {
  id: string;
  category: "respiratory" | "cardiovascular" | "neurological" | "obstetric" | "pediatric" | "trauma";
  severity: "emergency" | "urgent";
  description: string;
  clinicalNote?: string;
};

export type RedFlagResult = {
  detected: boolean;
  flags: RedFlag[];
  requiresHumanReview: boolean;
  uncertainties: string[];
};

export type RedFlagConfiguration = {
  disabledRuleIds?: readonly string[];
  oxygenSaturationEmergencyBelow?: number;
};

/**
 * RED FLAG DEFINITIONS
 * 
 * NOTE: These are INDICATOR rules, not diagnostic rules. They identify patients
 * who need immediate clinical assessment, NOT a diagnosis.
 */

export const TRIAGE_RED_FLAG_RULES: readonly RedFlag[] = [
  // Respiratory red flags
  {
    id: "resp_diff_breathing",
    category: "respiratory",
    severity: "emergency",
    description: "Difficulty breathing or severe shortness of breath",
    clinicalNote: "Check for chest indrawing, stridor, inability to speak in sentences",
  },
  {
    id: "resp_low_o2",
    category: "respiratory",
    severity: "emergency",
    description: "Oxygen saturation below 90%",
    clinicalNote: "Requires immediate oxygen therapy",
  },
  {
    id: "resp_stridor",
    category: "respiratory",
    severity: "emergency",
    description: "Stridor (harsh breathing sound) in calm state",
    clinicalNote: "Indicates severe airway obstruction",
  },

  // Cardiovascular red flags
  {
    id: "cardio_chest_pain",
    category: "cardiovascular",
    severity: "emergency",
    description: "Chest pain, especially with radiation to arm/jaw",
    clinicalNote: "Possible acute coronary syndrome",
  },
  {
    id: "cardio_severe_bleeding",
    category: "cardiovascular",
    severity: "emergency",
    description: "Severe or uncontrolled bleeding",
    clinicalNote: "Risk of hemorrhagic shock",
  },
  {
    id: "cardio_shock_signs",
    category: "cardiovascular",
    severity: "emergency",
    description: "Signs of shock (cold extremities, confusion, rapid pulse)",
    clinicalNote: "Immediate resuscitation needed",
  },

  // Neurological red flags
  {
    id: "neuro_altered_consciousness",
    category: "neurological",
    severity: "emergency",
    description: "Altered consciousness, confusion, or unresponsiveness",
    clinicalNote: "AVPU scale: Alert, Voice, Pain, Unresponsive",
  },
  {
    id: "neuro_seizure",
    category: "neurological",
    severity: "emergency",
    description: "Active seizure or recent prolonged seizure",
    clinicalNote: "Risk of status epilepticus",
  },
  {
    id: "neuro_severe_headache",
    category: "neurological",
    severity: "urgent",
    description: "Severe sudden headache (worst ever experienced)",
    clinicalNote: "Possible subarachnoid hemorrhage, needs urgent assessment",
  },

  // Obstetric red flags
  {
    id: "obs_bleeding_pregnancy",
    category: "obstetric",
    severity: "emergency",
    description: "Vaginal bleeding during pregnancy",
    clinicalNote: "Risk of placental abruption, miscarriage",
  },
  {
    id: "obs_severe_preeclampsia",
    category: "obstetric",
    severity: "emergency",
    description: "Severe headache, blurred vision, or epigastric pain in pregnancy",
    clinicalNote: "Signs of severe pre-eclampsia/eclampsia",
  },
  {
    id: "obs_prolonged_labor",
    category: "obstetric",
    severity: "emergency",
    description: "Prolonged labor (>12 hours) or obstructed labor",
    clinicalNote: "Risk of fetal distress, uterine rupture",
  },
  {
    id: "obs_premature_rupture",
    category: "obstetric",
    severity: "urgent",
    description: "Premature rupture of membranes (water breaking)",
    clinicalNote: "Risk of infection, preterm labor",
  },

  // Pediatric red flags (age-specific)
  {
    id: "peds_unable_feed",
    category: "pediatric",
    severity: "emergency",
    description: "Infant unable to drink or breastfeed",
    clinicalNote: "WHO IMCI danger sign",
  },
  {
    id: "peds_persistent_vomiting",
    category: "pediatric",
    severity: "emergency",
    description: "Child with persistent vomiting (everything)",
    clinicalNote: "Risk of severe dehydration",
  },
  {
    id: "peds_abnormally_sleepy",
    category: "pediatric",
    severity: "emergency",
    description: "Child abnormally sleepy or difficult to wake",
    clinicalNote: "WHO IMCI danger sign",
  },
  {
    id: "peds_convulsions",
    category: "pediatric",
    severity: "emergency",
    description: "Recent convulsions or seizure in child",
    clinicalNote: "Possible febrile seizure, meningitis, other serious cause",
  },

  // Trauma red flags
  {
    id: "trauma_major_injury",
    category: "trauma",
    severity: "emergency",
    description: "Major trauma, severe burns, or serious accident",
    clinicalNote: "Activate trauma protocol",
  },
  {
    id: "trauma_head_injury",
    category: "trauma",
    severity: "urgent",
    description: "Head injury with loss of consciousness",
    clinicalNote: "Risk of intracranial bleeding",
  },
];

const getRule = (id: string): RedFlag =>
  TRIAGE_RED_FLAG_RULES.find((rule) => rule.id === id)!;

/**
 * Normalize text for matching:
 * - Convert to lowercase
 * - Remove extra spaces
 * - Handle common spelling variations
 */
const SPELLING_VARIANTS: Record<string, string> = {
  brething: "breathing",
  breathng: "breathing",
  chset: "chest",
  bleedin: "bleeding",
  unconcious: "unconscious",
  unconciousness: "unconsciousness",
  siezure: "seizure",
  seizre: "seizure",
  pregant: "pregnant",
  pregnent: "pregnant",
};

function normalizeText(text: string): string {
  const normalized = text
    .toLowerCase()
    .trim()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s.,;!?-]/g, " ")
    .replace(/\s+/g, " ")
    // Normalize UK/US spelling variations
    .replace(/labour/gi, "labor")
    .replace(/foetus/gi, "fetus")
    .replace(/oedema/gi, "edema")
    .replace(/haemorrhage/gi, "hemorrhage")
    .replace(/caesarean/gi, "cesarean");

  return normalized.replace(/\b[a-z]+\b/g, (token) => SPELLING_VARIANTS[token] ?? token);
}

/**
 * Check for negation context around a keyword match.
 * Returns true if the match is negated (e.g., "no chest pain").
 * 
 * Negation indicators: no, not, denies, without, absent, negative for
 */
function isNegated(text: string, matchIndex: number): boolean {
  const previousClauses = text
    .slice(0, matchIndex)
    .split(/[.!?;,\n]|\bbut\b|\bhowever\b|\band\b/);
  const previousWords = (previousClauses[previousClauses.length - 1] ?? "")
    .trim()
    .split(/\s+/)
    .slice(-6);
  const context = previousWords.join(" ");
  const negations: RegExpExecArray[] = [];
  const pattern = /\b(?:no|not|denies?|without|absent|negative\s+for)\b/g;
  let negation: RegExpExecArray | null;
  while ((negation = pattern.exec(context)) !== null) negations.push(negation);
  if (negations.length === 0) return false;

  const nearest = negations[negations.length - 1];
  const previous = negations[negations.length - 2];
  if (previous) {
    const between = context
      .slice(previous.index + previous[0].length, nearest.index)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (between.length <= 2) return false;
  }
  return true;
}

/**
 * Match a pattern with spelling variations and negation awareness.
 * Returns the match index if found and not negated, otherwise -1.
 */
function matchPattern(text: string, patterns: string[]): number {
  const normalized = normalizeText(text);

  for (const pattern of patterns) {
    const normalizedPattern = normalizeText(pattern);
    const escapedPattern = normalizedPattern
      .split(/\s+/)
      .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\s-]+");
    const matches = new RegExp(`(^|[\\s.,;!?])${escapedPattern}(?=$|[\\s.,;!?])`, "g");
    let match: RegExpExecArray | null;
    while ((match = matches.exec(normalized)) !== null) {
      const index = match.index + match[1].length;
      if (!isNegated(normalized, index)) return index;
    }
  }

  return -1;
}

function hasNegatedPattern(text: string, patterns: string[]): boolean {
  const normalized = normalizeText(text);
  return patterns.some((pattern) => {
    const escapedPattern = normalizeText(pattern)
      .split(/\s+/)
      .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\s-]+");
    const matches = new RegExp(`(^|[\\s.,;!?])${escapedPattern}(?=$|[\\s.,;!?])`, "g");
    let match: RegExpExecArray | null;
    while ((match = matches.exec(normalized)) !== null) {
      if (isNegated(normalized, match.index + match[1].length)) return true;
    }
    return false;
  });
}

/**
 * Check symptom text for respiratory red flags
 */
function checkRespiratoryFlags(
  text: string,
  vitalSigns?: { oxygenSaturation?: number },
  oxygenSaturationEmergencyBelow = 90,
): RedFlag[] {
  const flags: RedFlag[] = [];

  // Breathing difficulty patterns
  const breathingPatterns = [
    "difficulty breathing",
    "shortness of breath",
    "breathlessness",
    "dyspnea",
    "cant breathe",
    "cannot breathe",
    "gasping",
    "respiratory distress",
    "breathing problem",
    "trouble breathing",
  ];

  if (matchPattern(text, breathingPatterns) !== -1) {
    flags.push(getRule("resp_diff_breathing"));
  }

  // Stridor
  if (matchPattern(text, ["stridor", "harsh breathing", "noisy breathing"]) !== -1) {
    flags.push(getRule("resp_stridor"));
  }

  // Check vital signs
  if (
    vitalSigns?.oxygenSaturation !== undefined &&
    Number.isFinite(vitalSigns.oxygenSaturation) &&
    vitalSigns.oxygenSaturation < oxygenSaturationEmergencyBelow
  ) {
    flags.push({
      ...getRule("resp_low_o2"),
      description: `Oxygen saturation below the configured ${oxygenSaturationEmergencyBelow}% threshold`,
    });
  }

  return flags;
}

/**
 * Check symptom text for cardiovascular red flags
 */
function checkCardiovascularFlags(text: string, vitalSigns?: { heartRate?: number; systolicBP?: number }): RedFlag[] {
  const flags: RedFlag[] = [];

  // Chest pain patterns
  const chestPainPatterns = [
    "chest pain",
    "chest discomfort",
    "chest tightness",
    "chest pressure",
    "angina",
    "heart pain",
    "cardiac pain",
  ];

  if (matchPattern(text, chestPainPatterns) !== -1) {
    flags.push(getRule("cardio_chest_pain"));
  }

  // Severe bleeding
  if (matchPattern(text, ["severe bleeding", "heavy bleeding", "uncontrolled bleeding", "hemorrhage", "blood loss"]) !== -1) {
    flags.push(getRule("cardio_severe_bleeding"));
  }

  // Shock signs
  const shockPatterns = [
    "cold extremities",
    "cold hands",
    "cold feet",
    "rapid pulse",
    "weak pulse",
    "confusion",
    "pale",
    "clammy",
    "shock",
  ];

  if (matchPattern(text, shockPatterns) !== -1) {
    flags.push(getRule("cardio_shock_signs"));
  }

  return flags;
}

/**
 * Check symptom text for neurological red flags
 */
function checkNeurologicalFlags(text: string, isPregnant?: boolean): RedFlag[] {
  const flags: RedFlag[] = [];

  // Altered consciousness
  const consciousnessPatterns = [
    "unconscious",
    "unresponsive",
    "not responding",
    "altered consciousness",
    "confused",
    "disoriented",
    "lethargic",
    "stupor",
    "coma",
  ];

  if (matchPattern(text, consciousnessPatterns) !== -1) {
    flags.push(getRule("neuro_altered_consciousness"));
  }

  // Seizures
  if (matchPattern(text, ["seizure", "convulsion", "fit", "seizing"]) !== -1) {
    flags.push(getRule("neuro_seizure"));
  }

  // Severe headache (but skip if pregnant - handled by obstetric check)
  if (!isPregnant) {
    const headachePatterns = [
      "worst headache",
      "severe headache",
      "sudden headache",
      "thunderclap headache",
      "intense headache",
    ];

    if (matchPattern(text, headachePatterns) !== -1) {
      flags.push(getRule("neuro_severe_headache"));
    }
  }

  return flags;
}

/**
 * Check symptom text for obstetric red flags
 */
function checkObstetricFlags(text: string, isPregnant: boolean): RedFlag[] {
  if (!isPregnant) return [];

  const flags: RedFlag[] = [];

  // Bleeding in pregnancy
  if (matchPattern(text, ["vaginal bleeding", "bleeding", "spotting", "blood"]) !== -1) {
    flags.push(getRule("obs_bleeding_pregnancy"));
  }

  // Pre-eclampsia signs
  const preeclampsiaPatterns = [
    "blurred vision",
    "vision changes",
    "epigastric pain",
    "severe headache",
    "swelling face",
    "sudden weight gain",
  ];

  if (matchPattern(text, preeclampsiaPatterns) !== -1) {
    flags.push(getRule("obs_severe_preeclampsia"));
  }

  // Labor complications
  if (matchPattern(text, ["prolonged labor", "obstructed labor"]) !== -1) {
    flags.push(getRule("obs_prolonged_labor"));
  }

  // Premature rupture of membranes
  if (matchPattern(text, ["water broke", "water breaking", "rupture", "leaking fluid"]) !== -1) {
    flags.push(getRule("obs_premature_rupture"));
  }

  return flags;
}

/**
 * Check symptom text for pediatric red flags
 */
function checkPediatricFlags(text: string, age?: number): RedFlag[] {
  // Only apply to children under 5 years (or if age unknown, check for child-related keywords)
  const isPediatric = (age !== undefined && age < 5) ||
    /\b(child|infant|baby|toddler|newborn|pediatric|paediatric)\b/i.test(text);

  if (!isPediatric) return [];

  const flags: RedFlag[] = [];

  // Unable to feed/drink
  if (matchPattern(text, ["unable to drink", "unable to feed", "unable to breastfeed", "not feeding", "refusing food"]) !== -1) {
    flags.push(getRule("peds_unable_feed"));
  }

  // Persistent vomiting
  if (matchPattern(text, ["persistent vomiting", "vomiting everything", "cant keep anything down", "continuous vomiting"]) !== -1) {
    flags.push(getRule("peds_persistent_vomiting"));
  }

  // Abnormally sleepy
  if (matchPattern(text, ["abnormally sleepy", "difficult to wake", "lethargic", "very sleepy", "unresponsive"]) !== -1) {
    flags.push(getRule("peds_abnormally_sleepy"));
  }

  // Convulsions
  if (matchPattern(text, ["convulsion", "seizure", "fit"]) !== -1) {
    flags.push(getRule("peds_convulsions"));
  }

  return flags;
}

/**
 * Check symptom text for trauma red flags
 */
function checkTraumaFlags(text: string): RedFlag[] {
  const flags: RedFlag[] = [];

  // Major trauma
  const traumaPatterns = [
    "major trauma",
    "serious accident",
    "severe injury",
    "multiple injuries",
    "road accident",
    "fall from height",
  ];

  if (matchPattern(text, traumaPatterns) !== -1) {
    flags.push(getRule("trauma_major_injury"));
  }

  // Head injury
  if (matchPattern(text, ["head injury", "head trauma", "loss of consciousness", "unconscious", "hit head"]) !== -1) {
    flags.push(getRule("trauma_head_injury"));
  }

  return flags;
}

/**
 * Main red-flag detection function.
 * 
 * This provides a deterministic, transparent safety floor that:
 * - Works offline
 * - Handles negation
 * - Normalizes spelling
 * - Is clinician-reviewable
 * 
 * @param symptomText - Patient-reported symptoms or clinical notes
 * @param context - Additional context (age, pregnancy status, vital signs)
 * @returns RedFlagResult with detected flags and review requirements
 */
export function detectRedFlags(
  symptomText: string,
  context?: {
    age?: number;
    isPregnant?: boolean;
    vitalSigns?: {
      heartRate?: number;
      systolicBP?: number;
      oxygenSaturation?: number;
      temperature?: number;
    };
  },
  configuration: RedFlagConfiguration = {},
): RedFlagResult {
  if (
    configuration.oxygenSaturationEmergencyBelow !== undefined &&
    (!Number.isFinite(configuration.oxygenSaturationEmergencyBelow) ||
      configuration.oxygenSaturationEmergencyBelow < 0 ||
      configuration.oxygenSaturationEmergencyBelow > 100)
  ) {
    throw new RangeError("Oxygen saturation threshold must be a finite value from 0 to 100");
  }
  const safeText = typeof symptomText === "string" ? symptomText : "";
  const normalized = normalizeText(safeText);
  const pregnancyReported = matchPattern(safeText, ["pregnant", "pregnancy", "trimester"]) !== -1;
  const pregnancyDenied = hasNegatedPattern(safeText, ["pregnant", "pregnancy"]);
  const pregnancyConflict =
    (context?.isPregnant === false && pregnancyReported) ||
    (context?.isPregnant === true && pregnancyDenied);
  const isPregnant = context?.isPregnant === true || pregnancyReported;
  const doubleNegative =
    /\b(?:no|not)\b(?:\s+\w+){0,2}\s+\b(?:no|not|without)\b/.test(normalized);
  const ambiguousLanguage =
    /\b(?:maybe|might|possibly|perhaps|unclear|unsure|not sure|cannot tell)\b/.test(normalized) ||
    doubleNegative;
  const contradictoryMention = hasContradictorySymptomMentions(safeText);
  const flags: RedFlag[] = [];

  // Run all category checks
  flags.push(
    ...checkRespiratoryFlags(
      safeText,
      context?.vitalSigns,
      configuration.oxygenSaturationEmergencyBelow,
    ),
  );
  flags.push(...checkCardiovascularFlags(safeText, context?.vitalSigns));
  flags.push(...checkNeurologicalFlags(safeText, isPregnant));
  flags.push(...checkObstetricFlags(safeText, isPregnant));
  flags.push(...checkPediatricFlags(safeText, context?.age));
  flags.push(...checkTraumaFlags(safeText));

  // Deduplicate flags by ID
  const disabledRuleIds = new Set(configuration.disabledRuleIds ?? []);
  const uniqueFlags = Array.from(
    new Map(flags.filter((flag) => !disabledRuleIds.has(flag.id)).map((flag) => [flag.id, flag])).values(),
  );

  // Determine if human review is required (any emergency flag or multiple urgent flags)
  const hasEmergency = uniqueFlags.some((f) => f.severity === "emergency");
  const urgentCount = uniqueFlags.filter((f) => f.severity === "urgent").length;
  const requiresHumanReview =
    hasEmergency || urgentCount >= 2 || ambiguousLanguage || contradictoryMention || pregnancyConflict;
  const uncertainties = [
    ...(ambiguousLanguage ? ["The symptom description includes uncertain language."] : []),
    ...(doubleNegative ? ["Double-negative wording requires clarification."] : []),
    ...(contradictoryMention ? ["The same symptom is both affirmed and denied."] : []),
    ...(pregnancyConflict ? ["Pregnancy status conflicts between the report and structured context."] : []),
  ];

  return {
    detected: uniqueFlags.length > 0,
    flags: uniqueFlags,
    requiresHumanReview,
    uncertainties,
  };
}

function hasContradictorySymptomMentions(text: string): boolean {
  const normalized = normalizeText(text);
  const terms = [
    "chest pain",
    "difficulty breathing",
    "shortness of breath",
    "bleeding",
    "unconscious",
    "seizure",
    "convulsion",
    "severe headache",
    "blurred vision",
    "unable to feed",
    "persistent vomiting",
    "head injury",
    "pregnant",
    "pregnancy",
  ];

  return terms.some((term) => {
    const normalizedTerm = normalizeText(term).replace(/\s+/g, "[\\s-]+");
    const expression = new RegExp(`(^|[\\s.,;!?])${normalizedTerm}(?=$|[\\s.,;!?])`, "g");
    const matches = Array.from(normalized.matchAll(expression));
    return (
      matches.some((match) => isNegated(normalized, (match.index ?? 0) + match[1].length)) &&
      matches.some((match) => !isNegated(normalized, (match.index ?? 0) + match[1].length))
    );
  });
}

/**
 * Get the highest priority level from detected red flags
 */
export function getRedFlagPriority(result: RedFlagResult): "emergency" | "urgent" | null {
  if (!result.detected || result.flags.length === 0) {
    return null;
  }

  const hasEmergency = result.flags.some((f) => f.severity === "emergency");
  return hasEmergency ? "emergency" : "urgent";
}
