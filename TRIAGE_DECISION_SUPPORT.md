# Triage decision-support boundaries

This feature is decision support only. It does not diagnose, rule out illness, prescribe treatment, confirm a referral or appointment, or replace a qualified clinician. The current rules and legacy numeric score have **not** been independently validated for clinical use or any particular region.

## Pipeline

1. The client and backend run the shared deterministic rules before any optional model request. Rule matches can only raise the safety signal; the language model has no urgency field and cannot change a clinician's recorded override.
2. The backend retains the legacy numeric score/category for interface compatibility. It is explicitly marked as unvalidated in the structured result and requires human review; it must not be interpreted as a validated clinical score.
3. Structured results are checked at runtime against `ClinicalTriageResultSchema`. Unknown urgency is represented as `undetermined`; the absence of a matching rule is not evidence of low risk.
4. Model support is disabled unless `TRIAGE_LLM_SUPPORT_ENABLED=true`. When enabled, it may only organize symptom phrases and suggest follow-up questions. Requests use a bounded, minimized symptom string without patient identifiers, age, pregnancy status, vitals, or patient ID. Email addresses, phone-like strings, and common name/date-of-birth labels are redacted as a best-effort measure, not guaranteed de-identification. Model output is schema-validated and discarded on malformed output, timeout, missing credentials, rate limit, or provider failure.
5. Doctor matching is a local directory/queue-load recommendation, not evidence of current availability, an appointment, or a completed referral. An empty directory produces no doctor assignment.

## Rules needing qualified-clinician approval

The exported `TRIAGE_RED_FLAG_RULES` are configurable indicator definitions. `detectRedFlags` also accepts `RedFlagConfiguration` for disabling rule IDs and changing the oxygen saturation threshold. These controls do not make a rule clinically valid. A qualified clinical governance group must review and approve **every item below**, including wording, thresholds, applicability by age/pregnancy, local escalation instructions, language variants, and the consequences of false positives/negatives:

- Respiratory: breathing difficulty, stridor/noisy breathing, and the default oxygen saturation threshold of 90%.
- Cardiovascular: chest pain, severe/uncontrolled bleeding, and shock-associated phrases.
- Neurological: altered consciousness, seizure/convulsion, and severe/sudden headache.
- Obstetric: bleeding during pregnancy, headache/vision/epigastric symptoms, prolonged or obstructed labor, and fluid leakage/rupture indicators. The current labor wording must not be treated as a validated time threshold.
- Pediatric: the under-five/textual-child scope and feeding, vomiting, sleepiness, and convulsion indicators.
- Trauma: major injury/accident and head injury indicators.
- Legacy backend scoring: age, heart-rate, systolic-pressure, oxygen-saturation, temperature cutoffs and score-to-category boundaries in `shared/triage.ts`.
- Legacy client category suggestions for pediatric, maternal, injury, dental, chronic, and general symptoms.

Do not enable clinical deployment based only on passing software tests. Require documented local clinical approval, usability testing, translation review, monitoring, and independent validation before using these outputs to direct care.

## Privacy, provider, and retention assumptions

- Provider credentials are server-side only (`BUILT_IN_FORGE_API_KEY`); never configure a public client key.
- External model support defaults off. Enabling it is an operator decision and must follow local consent, privacy, security, and provider-contract review. No provider retention, training, residency, or deletion guarantees are assumed here; verify them directly with the provider and document the approved configuration.
- Redaction is best-effort. Free text can still contain identifying or sensitive information, so do not enable external processing unless that residual risk is approved.
- Application logs do not intentionally include symptom text. The backend stores triage metadata and the submitted screening data in the triage record; the cache entry expires after one hour. Completed queue jobs are removed, but this application does not currently define a database retention/deletion schedule for triage records or screening data. Operators must set and enforce one under local policy.
