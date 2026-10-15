import { describe, expect, it, vi } from "vitest";

const memoryStore: Record<string, string> = {};

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => memoryStore[key] ?? null),
    setItem: vi.fn(async (key: string, val: string) => {
      memoryStore[key] = val;
    }),
    removeItem: vi.fn(async (key: string) => {
      delete memoryStore[key];
    }),
  },
}));

vi.mock("expo-linking", () => ({
  createURL: vi.fn((path: string) => `manus://${path}`),
  canOpenURL: vi.fn(async () => true),
  openURL: vi.fn(async () => { }),
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => { }),
  deleteItemAsync: vi.fn(async () => { }),
}));

import {
  createUserProfile,
  authenticateUser,
} from "../lib/health/userAuth";
import type { DoctorProfile } from "../lib/health/userAuth";

describe("Doctor Authentication & Profile Creation", () => {
  it("creates a doctor profile with formatted prefix and details", async () => {
    const profile = (await createUserProfile({
      name: "Sunita Patel",
      role: "doctor",
      doctorId: "MCI-99881",
      specialization: "Pediatrics / Child Health",
      facilityName: "Nandipur PHC",
      facilityId: "hosp-1",
      phone: "9876543210",
      passcode: "1234",
    })) as DoctorProfile;

    expect(profile.name).toBe("Dr. Sunita Patel");
    expect(profile.doctorId).toBe("MCI-99881");
    expect(profile.specialization).toBe("Pediatrics / Child Health");
    expect(profile.facilityName).toBe("Nandipur PHC");
    expect(profile.role).toBe("doctor");
  });

  it("authenticates existing doctor by MCI ID with correct PIN", async () => {
    const doctor = await authenticateUser("MCI-99881", "1234", "doctor");
    expect(doctor).toBeDefined();
    expect(doctor.name).toBe("Dr. Sunita Patel");
  });

  it("authenticates existing doctor by phone number with correct PIN", async () => {
    const doctor = await authenticateUser("987 654 3210", "1234", "doctor");
    expect(doctor).toBeDefined();
    expect(doctor.name).toBe("Dr. Sunita Patel");
  });

  it("rejects login with wrong passcode", async () => {
    await expect(authenticateUser("MCI-99881", "9999", "doctor")).rejects.toThrow(
      "Incorrect PIN",
    );
  });

  it("throws when user is not found", async () => {
    await expect(authenticateUser("MCI-000000", "1234", "doctor")).rejects.toThrow(
      "No user found",
    );
  });
});
