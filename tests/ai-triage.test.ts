import { describe, it, expect } from "vitest";
import { analyzeDiseaseRuleBased, matchBestDoctor } from "../lib/health/aiTriage";
import type { UserProfile } from "../lib/health/userAuth";

describe("aiTriage & Doctor Matching", () => {
  it("classifies emergency chest pain symptoms correctly", () => {
    const result = analyzeDiseaseRuleBased("Patient having severe chest pain and breathing difficulty");
    expect(result.priority).toBe("emergency");
    expect(result.recommendedSpecialization).toBe("Emergency & Trauma Care");
  });

  it("classifies pediatric symptoms correctly", () => {
    const result = analyzeDiseaseRuleBased("Child having high fever and cold");
    expect(result.priority).toBe("urgent");
    expect(result.recommendedSpecialization).toBe("Pediatrics / Child Health");
  });

  it("classifies maternal pregnancy symptoms correctly", () => {
    const result = analyzeDiseaseRuleBased("Pregnant woman reports vaginal bleeding");
    expect(result.priority).toBe("emergency");
    expect(result.recommendedSpecialization).toBe("Obstetrics & Gynecology");
  });

  it("does not elevate negated chest pain", () => {
    const result = analyzeDiseaseRuleBased("Patient denies chest pain");
    expect(result.priority).not.toBe("emergency");
  });

  it("matches the best suited doctor with the lowest queue load", () => {
    const mockDoctors: UserProfile[] = [
      {
        id: "doc-1",
        name: "Dr. Alice",
        role: "doctor",
        doctorId: "DOC-1",
        specialization: "Pediatrics / Child Health",
        facilityId: "hosp-1",
        facilityName: "Test Hospital",
        createdAt: Date.now(),
        lastLoginAt: Date.now(),
      },
      {
        id: "doc-2",
        name: "Dr. Bob",
        role: "doctor",
        doctorId: "DOC-2",
        specialization: "Pediatrics / Child Health",
        facilityId: "hosp-1",
        facilityName: "Test Hospital",
        createdAt: Date.now(),
        lastLoginAt: Date.now(),
      },
    ];

    const currentQueue = [
      { doctorId: "doc-1", status: "waiting" },
      { doctorId: "doc-1", status: "waiting" },
    ];

    const matched = matchBestDoctor("hosp-1", "Pediatrics / Child Health", mockDoctors, currentQueue);
    expect(matched?.id).toBe("doc-2");
    expect(matched?.name).toBe("Dr. Bob");
  });

  it("does not fabricate a doctor when the facility directory has no clinicians", () => {
    const matched = matchBestDoctor("missing-facility", "General Medicine (MBBS)", [], []);
    expect(matched).toBeNull();
  });

  it("does not recommend doctors from another facility", () => {
    const doctor = {
      id: "doc-other",
      name: "Dr. Other",
      role: "doctor" as const,
      doctorId: "DOC-OTHER",
      specialization: "General Medicine (MBBS)",
      facilityId: "other-hospital",
      facilityName: "Other Hospital",
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
    };
    expect(matchBestDoctor("hosp-1", "General Medicine (MBBS)", [doctor], [])).toBeNull();
  });
});
