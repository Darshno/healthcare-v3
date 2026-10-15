import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBaseUrl, SESSION_TOKEN_KEY } from "@/constants/oauth";
import { setSessionToken, removeSessionToken } from "@/lib/_core/auth";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type UserRole = "chief_doctor" | "doctor" | "asha_worker" | "receptionist";

export type DoctorSpecialization =
  | "General Medicine (MBBS)"
  | "Pediatrics / Child Health"
  | "Obstetrics & Gynecology"
  | "Emergency & Trauma Care"
  | "Community Medicine / MO"
  | "General Surgery"
  | "Dental & Oral Health";

export type BaseUserProfile = {
  id: string;
  name: string;
  role: UserRole;
  phone?: string;
  email?: string;
  passcodeHash?: string;
  facilityName: string;
  facilityId: string; // hospital UUID from hospitalRegistry
  createdAt: number;
  lastLoginAt: number;
};

export type DoctorProfile = BaseUserProfile & {
  role: "chief_doctor" | "doctor";
  doctorId: string;
  specialization: DoctorSpecialization | string;
};

export type HealthWorkerProfile = BaseUserProfile & {
  role: "asha_worker" | "receptionist";
  workerId: string;
  designation: "ASHA Worker" | "ANM Community Nurse" | "Receptionist" | "Anganwadi Worker";
  assignedVillage?: string;
};

// Patient is no longer a user role in auth — kept for backward compat
export type PatientProfile = BaseUserProfile & {
  role: never;
};

export type UserProfile = DoctorProfile | HealthWorkerProfile;

export type CreateUserInput = {
  name: string;
  role: UserRole;
  phone?: string;
  email?: string;
  passcode?: string;
  facilityName: string;
  facilityId: string;
  // Doctor fields
  doctorId?: string;
  specialization?: string;
  // Health worker fields
  workerId?: string;
  designation?: HealthWorkerProfile["designation"];
  assignedVillage?: string;
};

// Empty preset — no demo users
export const PRESET_USERS: UserProfile[] = [];

// ──────────────────────────────────────────────────────────────────────────────
// Storage Keys  (bumped to v3 so old v2 data is ignored)
// ──────────────────────────────────────────────────────────────────────────────

const USER_PROFILE_KEY = "rural-health-access.user-profile.v3";
const USER_REGISTRY_KEY = "rural-health-access.user-registry.v3";
const PORTAL_TOKEN_KEY = "rural-health-access.portal-token";

// ──────────────────────────────────────────────────────────────────────────────
// Hashing helpers
// ──────────────────────────────────────────────────────────────────────────────

function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

export function hashPasscode(passcode: string): string {
  return simpleHash(passcode.trim());
}

export function verifyPasscode(entered: string, storedHash: string): boolean {
  return simpleHash(entered.trim()) === storedHash;
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "").replace(/^00/, "+");
}

// ──────────────────────────────────────────────────────────────────────────────
// Portal token sync
// ──────────────────────────────────────────────────────────────────────────────

function safeBase64Encode(str: string): string {
  if (typeof btoa === "function") return btoa(str);
  if (typeof Buffer !== "undefined") return Buffer.from(str).toString("base64");
  return "";
}

function syncPortalToken(token: string) {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(PORTAL_TOKEN_KEY, token);
      window.localStorage.setItem(SESSION_TOKEN_KEY, token);
    }
  } catch {
    /* noop */
  }
}

function removePortalToken() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(PORTAL_TOKEN_KEY);
      window.localStorage.removeItem(SESSION_TOKEN_KEY);
    }
  } catch {
    /* noop */
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// CRUD
// ──────────────────────────────────────────────────────────────────────────────

export async function getStoredUserProfile(): Promise<UserProfile | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_PROFILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

export async function getRegisteredUsers(): Promise<UserProfile[]> {
  try {
    const raw = await AsyncStorage.getItem(USER_REGISTRY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as UserProfile[];
  } catch {
    return [];
  }
}

export async function getRegisteredUsersByRole(role: UserRole): Promise<UserProfile[]> {
  const all = await getRegisteredUsers();
  return all.filter((u) => u.role === role);
}

export async function saveRegisteredUser(profile: UserProfile): Promise<void> {
  try {
    const all = await getRegisteredUsers();
    const updated = [profile, ...all.filter((u) => u.id !== profile.id)];
    await AsyncStorage.setItem(USER_REGISTRY_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error("Failed to save registered user:", error);
  }
}

export async function ensureServerSession(
  profile: UserProfile,
  passcode?: string,
): Promise<string | null> {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return null;

  const identifier = profile.phone ? normalizePhone(profile.phone) : profile.id;

  // SECURITY: Require passcode - no default password
  if (!passcode || passcode.trim().length === 0) {
    console.warn("No passcode provided for server session");
    return null;
  }

  const password = passcode;

  // 1. Try login first
  try {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    if (loginRes.ok) {
      const data = await loginRes.json();
      if (data.accessToken) {
        syncPortalToken(data.accessToken);
        await setSessionToken(data.accessToken);
        return data.accessToken;
      }
    }
  } catch {
    /* server offline or register needed */
  }

  // 2. If login failed because user is not registered on server DB yet, register now
  try {
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        openId: identifier,
        name: profile.name,
        password,
        role: profile.role,
        hospitalId: Number(profile.facilityId) || 1,
        phone: profile.phone ? normalizePhone(profile.phone) : undefined,
        email: profile.email || undefined,
      }),
    });
    if (regRes.ok) {
      const regData = await regRes.json();
      if (regData.accessToken) {
        syncPortalToken(regData.accessToken);
        await setSessionToken(regData.accessToken);
        return regData.accessToken;
      }
    }
  } catch (err) {
    console.warn("Could not register user session on server:", err);
  }

  return null;
}

export async function storeUserSession(
  profile: UserProfile,
  token?: string,
  password?: string,
): Promise<void> {
  try {
    const updatedProfile = { ...profile, lastLoginAt: Date.now() };
    await AsyncStorage.setItem(USER_PROFILE_KEY, JSON.stringify(updatedProfile));
    await saveRegisteredUser(updatedProfile);

    let activeToken = token;
    const isDummy = activeToken && activeToken.endsWith(".sig");
    if (!activeToken || isDummy) {
      const serverToken = await ensureServerSession(profile, password);
      if (serverToken) {
        activeToken = serverToken;
      }
    }

    if (activeToken) {
      syncPortalToken(activeToken);
      await setSessionToken(activeToken);
    }
  } catch (error) {
    console.error("Failed to store user session:", error);
  }
}


export async function clearUserSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(USER_PROFILE_KEY);
    removePortalToken();
    await removeSessionToken();
  } catch (error) {
    console.error("Failed to clear user session:", error);
  }
}

export async function createUserProfile(input: CreateUserInput): Promise<UserProfile> {
  const timestamp = Date.now();
  const id = `${input.role.slice(0, 3)}-${timestamp.toString(36)}`;

  if (!input.facilityName?.trim()) throw new Error("Facility name is required.");
  if (!input.facilityId?.trim()) throw new Error("Hospital is required.");
  if (!input.passcode?.trim()) throw new Error("A passcode is required.");

  const passcodeHash = hashPasscode(input.passcode.trim());
  let profile: UserProfile;

  if (input.role === "chief_doctor" || input.role === "doctor") {
    const formattedName = input.name.trim().startsWith("Dr.")
      ? input.name.trim()
      : `Dr. ${input.name.trim()}`;
    profile = {
      id,
      name: formattedName,
      role: input.role,
      doctorId: input.doctorId?.trim() || `DOC-${Math.floor(1000 + Math.random() * 9000)}`,
      specialization: input.specialization || "General Medicine (MBBS)",
      facilityName: input.facilityName.trim(),
      facilityId: input.facilityId,
      phone: input.phone?.trim(),
      email: input.email?.trim(),
      passcodeHash,
      createdAt: timestamp,
      lastLoginAt: timestamp,
    } as DoctorProfile;
  } else {
    profile = {
      id,
      name: input.name.trim(),
      role: input.role,
      workerId: input.workerId?.trim() || `WORK-${Math.floor(100 + Math.random() * 900)}`,
      designation: input.designation || (input.role === "receptionist" ? "Receptionist" : "ASHA Worker"),
      assignedVillage: input.assignedVillage?.trim(),
      facilityName: input.facilityName.trim(),
      facilityId: input.facilityId,
      phone: input.phone?.trim(),
      email: input.email?.trim(),
      passcodeHash,
      createdAt: timestamp,
      lastLoginAt: timestamp,
    } as HealthWorkerProfile;
  }

  const baseUrl = getApiBaseUrl();
  let serverToken: string | undefined;
  if (baseUrl) {
    let serverResponse: Response;
    try {
      serverResponse = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openId: input.phone ? normalizePhone(input.phone) : id,
          name: input.name.trim(),
          password: input.passcode.trim(),
          role: input.role,
          hospitalId: Number(input.facilityId) || 1,
          phone: input.phone ? normalizePhone(input.phone) : undefined,
          email: input.email?.trim() || undefined,
        }),
      });
    } catch {
      throw new Error(`Cannot reach the healthcare server at ${baseUrl}. Start the API server or check EXPO_PUBLIC_API_BASE_URL.`);
    }

    if (!serverResponse.ok) {
      const detail = await serverResponse.text().catch(() => "");
      throw new Error(detail || "Unable to create account on the server.");
    }

    const serverData = (await serverResponse.json()) as { accessToken?: string };
    serverToken = serverData.accessToken;
  }

  await storeUserSession(profile, serverToken, input.passcode.trim());
  return profile;
}

export async function authenticateUser(
  identifier: string,
  passcode: string,
  targetRole?: UserRole,
): Promise<UserProfile> {
  const query = identifier.trim().toLowerCase();
  const all = await getRegisteredUsers();

  const found = all.find((u) => {
    if (targetRole && u.role !== targetRole) return false;
    const matchesName = u.name.toLowerCase() === query || u.name.toLowerCase().includes(query);
    const matchesPhone = u.phone && normalizePhone(u.phone) === normalizePhone(query);

    let matchesId = false;
    if (u.role === "chief_doctor" || u.role === "doctor") {
      matchesId = (u as DoctorProfile).doctorId.toLowerCase() === query;
    } else {
      matchesId = (u as HealthWorkerProfile).workerId.toLowerCase() === query;
    }

    return matchesName || matchesPhone || matchesId;
  });

  if (!found) {
    const baseUrl = getApiBaseUrl();
    if (baseUrl) {
      try {
        const response = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier: query, password: passcode }),
        });

        if (response.ok) {
          const data = (await response.json()) as {
            accessToken: string;
            user: {
              id: number;
              name: string | null;
              role: string;
              phone: string | null;
              email: string | null;
              hospitalId: number;
              hospital?: { name?: string };
            };
          };
          const roleMap: Record<string, UserRole> = {
            CHIEF_DOCTOR: "chief_doctor",
            chief_doc: "chief_doctor",
            DOCTOR: "doctor",
            doctor: "doctor",
            ASHA_WORKER: "asha_worker",
            asha: "asha_worker",
            RECEPTIONIST: "receptionist",
            receptionist: "receptionist",
          };
          const role = roleMap[data.user.role];
          if (role && (!targetRole || role === targetRole)) {
            const profile = {
              id: String(data.user.id),
              name: data.user.name || query,
              role,
              phone: data.user.phone || (/^\+?\d[\d\s-]{6,}$/.test(query) ? query : undefined),
              email: data.user.email || undefined,
              facilityName: data.user.hospital?.name || "Registered Hospital",
              facilityId: String(data.user.hospitalId),
              createdAt: Date.now(),
              lastLoginAt: Date.now(),
              ...(role === "doctor" || role === "chief_doctor"
                ? { doctorId: query, specialization: "General Medicine (MBBS)" }
                : { workerId: query, designation: role === "receptionist" ? "Receptionist" : "ASHA Worker" }),
            } as UserProfile;
            await storeUserSession(profile, data.accessToken, passcode);
            return profile;
          }
        }
      } catch {
        // Fall through to the local error when the server is unavailable.
      }
    }

    throw new Error(
      `No user found matching "${identifier}". Check your details or register a new account.`,
    );
  }

  if (found.passcodeHash) {
    if (!passcode?.trim()) throw new Error("Please enter your PIN or passcode.");
    if (!verifyPasscode(passcode, found.passcodeHash)) {
      throw new Error("Incorrect PIN / passcode. Please try again.");
    }
  }

  await storeUserSession(found, undefined, passcode);
  return found;
}
