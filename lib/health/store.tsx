import NetInfo from "@react-native-community/netinfo";
import { Alert } from "react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { priorityLabel, priorityReasonLabel, referralLabel, syncLabel, translate, type TranslationKey } from "./i18n";
import { serializeOperation, type SyncTransport } from "./sync";
import { analyzeDiseaseRuleBased, matchBestDoctor } from "./aiTriage";
import { getRegisteredUsers } from "./userAuth";
import {
  ensureMigrated,
  hydrateAll,
  createDebouncedWriter,
  createSyncRetryScheduler,
  writeSection,
  type MetaBundle,
} from "./offlineStorage";
import type {
  AppLanguage,
  Appointment,
  AppointmentStatus,
  Bed,
  BedOccupancy,
  CareTag,
  CurrentUser,
  Encounter,
  HealthState,
  HospitalFacility,
  HospitalUnit,
  InventoryTransactionType,
  Medicine,
  MedicineOrder,
  MedicineOrderItem,
  MedicineOrderStatus,
  OfflineOperation,
  Patient,
  Priority,
  PriorityInput,
  QueueEntry,
  QueueStatus,
  ReferralStatus,
  SyncState,
  UserRole,
  VaccinationRecord,
} from "./types";

// Legacy storage key removed — offlineStorage.ts handles all persistence
let sequence = 0;
const makeId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(sequence += 1).toString(36)}`;
const now = Date.now();

const EMPTY_STATE: HealthState = {
  currentUser: null,
  language: "en",
  patients: [],
  queue: [],
  encounters: [],
  referrals: [],
  medicines: [],
  inventoryTransactions: [],
  operations: [],
  hospitals: [],
  appointments: [],
  medicineOrders: [],
  hospitalUnits: [],
  beds: [],
  bedOccupancies: [],
  vaccinationRecords: [],
  lastSyncedAt: 0,
};

type RegistrationInput = {
  name: string;
  age: number;
  sex: Patient["sex"];
  contact?: string;
  disease?: string; // optional symptom/disease note for triage
};

type BookAppointmentInput = {
  patientId: string;
  patientName: string;
  patientPhone?: string;
  facilityId: string;
  facilityName: string;
  doctorId: string;
  doctorName: string;
  specialty: string;
  date: string;
  timeSlot: string;
  reason: string;
  isEmergency?: boolean;
};

type RequestEmergencyInput = {
  patientId: string;
  patientName: string;
  patientPhone?: string;
  facilityId: string;
  facilityName: string;
  reason: string;
  symptoms: string[];
  severity?: "critical" | "severe" | "moderate";
};

type OrderMedicineInput = {
  patientId: string;
  patientName: string;
  patientPhone?: string;
  facilityId?: string;
  facilityName: string;
  items: MedicineOrderItem[];
  fulfillmentType: "pickup_phc" | "asha_home_delivery";
  notes?: string;
};

type HealthContextValue = {
  state: HealthState;
  isHydrated: boolean;
  syncing: boolean;
  syncError: string | null;
  t: (key: TranslationKey) => string;
  priorityLabel: (priority: Priority) => string;
  priorityReasonLabel: (reason: Parameters<typeof priorityReasonLabel>[1]) => string;
  referralLabel: (status: ReferralStatus) => string;
  syncLabel: (syncState: SyncState) => string;
  setLanguage: (language: AppLanguage) => void;
  setCurrentUser: (user: CurrentUser | null) => void;
  // Patient & Clinical Actions
  registerPatient: (input: RegistrationInput) => string;
  joinQueue: (input: { patientId: string; service: string; priority?: Priority; priorityReason?: Parameters<typeof priorityReasonLabel>[1] }) => string;
  updateQueueStatus: (queueId: string, status: QueueStatus) => void;
  overrideQueuePriority: (queueId: string, priority: Priority, reason: string) => void;
  addEncounter: (patientId: string, note: string, diagnosis?: string, prescriptions?: string[], doctorName?: string) => void;
  createReferral: (input: { patientId: string; destination: string; reason: string; urgency: Priority }) => void;
  updateReferralStatus: (referralId: string, status: ReferralStatus) => void;
  recordInventoryTransaction: (medicineId: string, type: InventoryTransactionType, quantity: number) => void;
  addMedicine: (input: { name: string; localName?: string; category?: string; unit: string; minimumStock: number }) => void;
  // Appointment & Medicine Actions
  bookAppointment: (input: BookAppointmentInput) => string;
  cancelAppointment: (appointmentId: string) => void;
  requestEmergencyAppointment: (input: RequestEmergencyInput) => string;
  orderMedicine: (input: OrderMedicineInput) => string;
  updateMedicineOrderStatus: (orderId: string, status: MedicineOrderStatus) => void;
  // Bed Management Actions
  occupyBed: (bedId: string, patientId: string, notes?: string) => void;
  releaseBed: (bedId: string) => void;
  getBedsByUnit: (unitId: string) => Bed[];
  getUnitStats: (unitId: string) => { unit: HospitalUnit; totalBeds: number; occupiedBeds: number; availableBeds: number; maintenanceBeds: number; occupancyRate: number } | null;
  setMaintenanceBed: (bedId: string, inMaintenance: boolean, notes?: string) => void;
  addWard: (wardName: string, bedCount: number) => void;
  getNearbyHospitalsWithBeds: (maxDistance?: number) => HospitalFacility[];
  getFacilityUnits: (facilityId: string) => HospitalUnit[];
  getFacilityStats: (facilityId: string) => {
    facilityId: string;
    totalBeds: number;
    occupiedBeds: number;
    availableBeds: number;
    maintenanceBeds: number;
    occupancyRate: number;
    isFull: boolean;
    units: Array<HospitalUnit & { occupiedBeds: number; availableBeds: number }>;
  };
  syncNow: () => void;
  /** Whether the device is effectively online (real network AND forceOffline is off). */
  isOnline: boolean;
  /** When true, the store behaves as if offline regardless of real connectivity. */
  forceOffline: boolean;
  setForceOffline: (value: boolean) => void;
  getPatient: (patientId: string) => Patient | undefined;
  getPatientEncounters: (patientId: string) => Encounter[];
  getPatientAppointments: (patientId: string) => Appointment[];
  getPatientOrders: (patientId: string) => MedicineOrder[];
  getPatientActiveQueue: (patientId: string) => QueueEntry | undefined;
  createVaccinationSchedule: (patientId: string, dob?: Date) => void;
  markVaccineAdministered: (recordId: string, doctorName: string) => void;
};

const HealthContext = createContext<HealthContextValue | undefined>(undefined);

/**
 * Creates an offline operation entry with the full entity payload snapshot.
 * The payload MUST be provided so the server can replay the operation exactly.
 * @param payload - stringified JSON snapshot of the entity being operated on
 */
function addOperation(state: HealthState, type: string, entityId: string, payload?: object): HealthState {
  const operation: OfflineOperation = {
    id: makeId("op"),
    type,
    entityId,
    createdAt: Date.now(),
    payload: payload ? JSON.stringify(payload) : undefined,
  };
  return { ...state, operations: [...state.operations, operation] };
}

// ─── Per-section debounced writers (created once, stable across renders) ────────
const writePatientsDebounced   = createDebouncedWriter<HealthState["patients"]>("patients", 400);
const writeQueueDebounced      = createDebouncedWriter<HealthState["queue"]>("queue", 400);
const writeMedicinesDebounced  = createDebouncedWriter<HealthState["medicines"]>("medicines", 400);
const writeEncountersDebounced = createDebouncedWriter<HealthState["encounters"]>("encounters", 600);
const writeReferralsDebounced  = createDebouncedWriter<HealthState["referrals"]>("referrals", 600);
const writeBedsDebounced       = createDebouncedWriter<HealthState["beds"]>("beds", 400);
const writeUnitsDebounced      = createDebouncedWriter<HealthState["hospitalUnits"]>("units", 600);
const writeOpsDebounced        = createDebouncedWriter<HealthState["operations"]>("ops", 300);
const writeInventoryDebounced  = createDebouncedWriter<HealthState["inventoryTransactions"]>("inventory", 500);
const writeVaccinationsDebounced = createDebouncedWriter<HealthState["vaccinationRecords"]>("vaccinations", 500);

export function HealthProvider({ children, syncTransport }: PropsWithChildren<{ syncTransport?: SyncTransport }>) {
  const [state, setState] = useState<HealthState>(EMPTY_STATE);
  const [isHydrated, setIsHydrated] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [networkOnline, setNetworkOnline] = useState<boolean>(true);
  const [forceOffline, setForceOffline] = useState<boolean>(false);
  const isOnline = networkOnline && !forceOffline;
  const transportRef = useRef<SyncTransport | undefined>(syncTransport);
  transportRef.current = syncTransport;

  // ─── Hydration: parallel section reads with schema migration ──────────────────
  useEffect(() => {
    ensureMigrated()
      .then(hydrateAll)
      .then((sections) => {
        setState((previous) => ({
          ...EMPTY_STATE,
          patients:             sections.patients   as HealthState["patients"],
          queue:                sections.queue      as HealthState["queue"],
          encounters:           sections.encounters as HealthState["encounters"],
          referrals:            sections.referrals  as HealthState["referrals"],
          medicines:            sections.medicines  as HealthState["medicines"],
          inventoryTransactions:sections.inventory  as HealthState["inventoryTransactions"],
          beds:                 sections.beds       as HealthState["beds"],
          hospitalUnits:        sections.units      as HealthState["hospitalUnits"],
          operations:           sections.ops        as HealthState["operations"],
          vaccinationRecords:   (sections.vaccinations ?? []) as HealthState["vaccinationRecords"],
          language:             (sections.meta?.language as HealthState["language"]) ?? "en",
          lastSyncedAt:         sections.meta?.lastSyncedAt ?? 0,
          currentUser:          previous.currentUser ?? (sections.meta?.currentUser as HealthState["currentUser"]) ?? null,
        }));
      })
      .catch(() => undefined)
      .finally(() => setIsHydrated(true));
  }, []);

  // ─── Persists: debounce writes per section (avoids serialising whole state) ──
  useEffect(() => {
    if (!isHydrated) return;
    writePatientsDebounced(state.patients);
    writeQueueDebounced(state.queue);
    writeMedicinesDebounced(state.medicines);
    writeEncountersDebounced(state.encounters);
    writeReferralsDebounced(state.referrals);
    writeBedsDebounced(state.beds);
    writeUnitsDebounced(state.hospitalUnits);
    writeOpsDebounced(state.operations);
    writeInventoryDebounced(state.inventoryTransactions);
    writeVaccinationsDebounced(state.vaccinationRecords);
    // Meta (lightweight, write immediately)
    const meta: MetaBundle = {
      language: state.language,
      lastSyncedAt: state.lastSyncedAt,
      currentUser: state.currentUser,
    };
    writeSection("meta", meta).catch(() => undefined);
  }, [isHydrated, state]);

  const setLanguage = useCallback((language: AppLanguage) => {
    setState((previous) => ({ ...previous, language }));
  }, []);

  const setCurrentUser = useCallback((user: CurrentUser | null) => {
    setState((previous) => ({ ...previous, currentUser: user }));
  }, []);


  // Keyword-based triage from disease note
  const inferPriority = (disease?: string): Priority => {
    if (!disease) return "routine";
    const d = disease.toLowerCase();
    if (
      d.includes("emergency") || d.includes("chest pain") ||
      d.includes("breathing") || d.includes("unconscious") ||
      d.includes("bleeding") || d.includes("seizure") ||
      d.includes("stroke") || d.includes("heart attack")
    ) return "emergency";
    if (
      d.includes("fever") || d.includes("pain") || d.includes("infection") ||
      d.includes("fracture") || d.includes("vomit") || d.includes("diarrhea") ||
      d.includes("diarrhoea") || d.includes("wound") || d.includes("burn")
    ) return "urgent";
    if (
      d.includes("diabetes") || d.includes("bp") || d.includes("blood pressure") ||
      d.includes("chronic") || d.includes("follow up") || d.includes("follow-up")
    ) return "priority";
    return "routine";
  };

  const registerPatient = useCallback((input: RegistrationInput) => {
    if (!state.currentUser) {
      Alert.alert("Session Error", "No active user session found. Please log in.");
      return "";
    }
    const currentRole = state.currentUser.role;
    if (currentRole !== "asha_worker" && currentRole !== "receptionist") {
      Alert.alert("Permission Denied", "Only ASHA workers and receptionists can register patients.");
      return "";
    }

    const patientId = makeId("patient");
    const queueId = makeId("queue");
    const timestamp = Date.now();

    // Perform disease triage & doctor matching
    const triageResult = analyzeDiseaseRuleBased(input.disease || "", { age: input.age });
    const priority = triageResult.priority;
    const priorityReason = triageResult.priorityReason;

    // Doctor matching
    let matchedDoctorName: string | undefined;
    let matchedDoctorId: string | undefined;
    let matchedSpecialty = triageResult.recommendedSpecialization;

    getRegisteredUsers().then((users) => {
      const match = matchBestDoctor(
        state.currentUser?.facilityId || "",
        triageResult.recommendedSpecialization,
        users,
        state.queue
      );
      if (match) {
        matchedDoctorName = match.name;
        matchedDoctorId = match.id;
        matchedSpecialty = match.specialization as any;
        // Update queue entry with matched doctor
        setState((prev) => ({
          ...prev,
          queue: prev.queue.map((q) =>
            q.id === queueId
              ? { ...q, doctorName: match.name, doctorId: match.id, specialty: match.specialization }
              : q
          ),
        }));
      }
    }).catch(() => null);

    const token = 100 + (state.queue.length + 1);

    const patient: Patient = {
      id: patientId,
      facilityId: state.currentUser.facilityId,
      localId: `RH-${Math.floor(1000 + Math.random() * 9000)}`,
      name: input.name.trim(),
      age: input.age,
      sex: input.sex,
      contact: input.contact?.trim(),
      disease: input.disease?.trim(),
      careTags: ["general"],
      allergies: ["Not recorded"],
      currentMedicines: [],
      syncState: "pending",
      updatedAt: timestamp,
    };
    const queueEntry: QueueEntry = {
      id: queueId,
      facilityId: state.currentUser.facilityId,
      patientId,
      service: `${matchedSpecialty} OPD`,
      arrivedAt: timestamp,
      priority,
      priorityReason,
      status: "waiting",
      tokenNumber: token,
      roomNumber: "Triage & OPD",
      doctorName: matchedDoctorName,
      doctorId: matchedDoctorId,
      specialty: matchedSpecialty,
      syncState: "pending",
    };
    const triageEncounter: Encounter = {
      id: makeId("encounter"),
      facilityId: state.currentUser.facilityId,
      patientId,
      type: "triage",
      note: `Triage (${priority}): ${triageResult.clinicalSummary}. Doctor assignment: ${
        matchedDoctorName ?? "not recorded"
      }. Recommended specialty: ${matchedSpecialty}.`,
      createdAt: timestamp,
      syncState: "pending",
    };
    setState((previous) => {
      const next = {
        ...previous,
        patients: [patient, ...previous.patients],
        queue: [queueEntry, ...previous.queue],
        encounters: [triageEncounter, ...previous.encounters],
      };
      return addOperation(
        addOperation(next, "patient.create", patientId, patient),
        "queue.add", queueId, queueEntry
      );
    });
    return patientId;
  }, [state.queue, state.currentUser]);

  const joinQueue = useCallback((input: { patientId: string; service: string; priority?: Priority; priorityReason?: Parameters<typeof priorityReasonLabel>[1] }) => {
    if (!state.currentUser || (state.currentUser.role !== "asha_worker" && state.currentUser.role !== "receptionist")) {
      Alert.alert("Permission Denied", "Only ASHA workers or receptionists can add patients to the queue.");
      return "";
    }

    const patientRecord = state.patients.find((p) => p.id === input.patientId);
    const triageResult = analyzeDiseaseRuleBased(
      patientRecord?.disease || "",
      patientRecord ? { age: patientRecord.age } : undefined,
    );

    const queueId = makeId("queue");
    const timestamp = Date.now();
    const token = 100 + (state.queue.length + 1);

    let matchedDoctorName: string | undefined;
    let matchedDoctorId: string | undefined;

    getRegisteredUsers().then((users) => {
      const match = matchBestDoctor(
        state.currentUser?.facilityId || "",
        triageResult.recommendedSpecialization,
        users,
        state.queue
      );
      if (match) {
        matchedDoctorName = match.name;
        matchedDoctorId = match.id;
        setState((prev) => ({
          ...prev,
          queue: prev.queue.map((q) =>
            q.id === queueId ? { ...q, doctorName: match.name, doctorId: match.id } : q
          ),
        }));
      }
    }).catch(() => null);

    const queueEntry: QueueEntry = {
      id: queueId,
      facilityId: state.currentUser.facilityId,
      patientId: input.patientId,
      service: input.service || `${triageResult.recommendedSpecialization} OPD`,
      arrivedAt: timestamp,
      priority: input.priority || triageResult.priority,
      priorityReason: input.priorityReason || triageResult.priorityReason,
      status: "waiting",
      tokenNumber: token,
      roomNumber: "General OPD",
      doctorName: matchedDoctorName,
      doctorId: matchedDoctorId,
      specialty: triageResult.recommendedSpecialization,
      syncState: "pending",
    };

    setState((previous) => {
      const next = {
        ...previous,
        queue: [...previous.queue, queueEntry],
      };
      return addOperation(next, "queue.add", queueId, queueEntry);
    });

    return queueId;
  }, [state.queue.length, state.currentUser]);

  const updateQueueStatus = useCallback((queueId: string, status: QueueStatus) => {
    if (!state.currentUser || (state.currentUser.role !== "asha_worker" && state.currentUser.role !== "doctor" && state.currentUser.role !== "chief_doctor")) {
      Alert.alert("Permission Denied", "You do not have permission to update queue status.");
      return;
    }

    setState((previous) => {
      const updated = previous.queue.map((item) => item.id === queueId ? { ...item, status, syncState: "pending" as const } : item);
      const next = { ...previous, queue: updated };
      const updatedEntry = updated.find((q) => q.id === queueId);
      return addOperation(next, "queue.status", queueId, updatedEntry ? { status } : undefined);
    });
  }, [state.currentUser]);

  const overrideQueuePriority = useCallback((queueId: string, priority: Priority, reason: string) => {
    if (!state.currentUser || (state.currentUser.role !== "doctor" && state.currentUser.role !== "chief_doctor")) {
      Alert.alert("Permission Denied", "Only doctors can override queue priority.");
      return;
    }

    setState((previous) => {
      const updated = previous.queue.map((item) => item.id === queueId ? { ...item, priority, priorityReason: "clinicianUrgent" as const, overrideReason: reason, syncState: "pending" as const } : item);
      const next = { ...previous, queue: updated };
      return addOperation(next, "queue.override", queueId, { priority, overrideReason: reason });
    });
  }, [state.currentUser]);

  const addEncounter = useCallback((patientId: string, note: string, diagnosis?: string, prescriptions?: string[], doctorName?: string) => {
    if (!state.currentUser || (state.currentUser.role !== "doctor" && state.currentUser.role !== "chief_doctor")) {
      Alert.alert("Permission Denied", "Only doctors can record encounters.");
      return;
    }

    const encounter: Encounter = {
      id: makeId("encounter"),
      facilityId: state.currentUser.facilityId,
      patientId,
      type: "consultation",
      note,
      diagnosis,
      prescriptions,
      doctorName,
      createdAt: Date.now(),
      syncState: "pending",
    };
    setState((previous) => addOperation(
      { ...previous, encounters: [encounter, ...previous.encounters] },
      "encounter.create", encounter.id, encounter
    ));
  }, [state.currentUser]);

  const createReferral = useCallback((input: { patientId: string; destination: string; reason: string; urgency: Priority }) => {
    if (!state.currentUser || (state.currentUser.role !== "doctor" && state.currentUser.role !== "chief_doctor")) {
      Alert.alert("Permission Denied", "Only clinicians can create referrals.");
      return;
    }

    const referral = {
      id: makeId("referral"),
      facilityId: state.currentUser.facilityId,
      ...input,
      status: "draft" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      syncState: "pending" as const
    };
    setState((previous) => addOperation(
      { ...previous, referrals: [referral, ...previous.referrals] },
      "referral.create", referral.id, referral
    ));
  }, [state.currentUser]);

  const updateReferralStatus = useCallback((referralId: string, status: ReferralStatus) => {
    if (!state.currentUser || (state.currentUser.role !== "doctor" && state.currentUser.role !== "chief_doctor")) {
      Alert.alert("Permission Denied", "You do not have permission to update referral status.");
      return;
    }

    setState((previous) => {
      const updated = previous.referrals.map((item) => item.id === referralId ? { ...item, status, updatedAt: Date.now(), syncState: "pending" as const } : item);
      const next = { ...previous, referrals: updated };
      return addOperation(next, "referral.status", referralId, { status });
    });
  }, [state.currentUser]);

  const recordInventoryTransaction = useCallback((medicineId: string, type: InventoryTransactionType, quantity: number) => {
    if (!state.currentUser) {
      Alert.alert("Session Error", "Please sign in to update medicine stock.");
      return;
    }
    const signedQuantity = type === "receipt" ? Math.abs(quantity) : -Math.abs(quantity);
    const transaction = { id: makeId("inventory"), medicineId, type, quantity: signedQuantity, createdAt: Date.now(), syncState: "pending" as const };
    setState((previous) => {
      const next = {
        ...previous,
        medicines: previous.medicines.map((medicine) => medicine.id === medicineId ? { ...medicine, stock: Math.max(0, medicine.stock + signedQuantity), syncState: "pending" as const } : medicine),
        inventoryTransactions: [transaction, ...previous.inventoryTransactions],
      };
      return addOperation(next, `inventory.${type}`, transaction.id, transaction);
    });
  }, [state.currentUser]);

  const addMedicine = useCallback((input: { name: string; localName?: string; category?: string; unit: string; minimumStock: number }) => {
    if (!state.currentUser) {
      Alert.alert("Session Error", "Please sign in to add medicines.");
      return;
    }
    const timestamp = Date.now();
    const id = makeId("med");
    const medicine: Medicine = {
      id,
      facilityId: state.currentUser.facilityId,
      name: input.name.trim(),
      localName: input.localName?.trim() || input.name.trim(),
      category: (input.category?.trim() as any) || "general",
      unit: input.unit.trim(),
      stock: 0,
      minimumStock: input.minimumStock || 0,
      expiryDays: 365,
      isGovtSupply: true,
      pricePerUnit: 0,
      lastSyncedAt: timestamp,
      syncState: "pending",
    };
    setState((previous) => {
      const next = {
        ...previous,
        medicines: [medicine, ...previous.medicines],
      };
      return addOperation(next, "medicine.create", id);
    });
  }, [state.currentUser]);

  const bookAppointment = useCallback((input: BookAppointmentInput): string => {
    const aptId = makeId("apt");
    const appointment: Appointment = {
      id: aptId,
      patientId: input.patientId,
      patientName: input.patientName,
      patientPhone: input.patientPhone,
      facilityId: input.facilityId,
      facilityName: input.facilityName,
      doctorId: input.doctorId,
      doctorName: input.doctorName,
      specialty: input.specialty,
      date: input.date,
      timeSlot: input.timeSlot,
      reason: input.reason,
      isEmergency: !!input.isEmergency,
      status: "confirmed",
      createdAt: Date.now(),
    };

    setState((previous) => {
      const next = { ...previous, appointments: [appointment, ...previous.appointments] };
      return addOperation(next, "appointment.book", aptId);
    });

    return aptId;
  }, []);

  const cancelAppointment = useCallback((appointmentId: string) => {
    setState((previous) => {
      const next = {
        ...previous,
        appointments: previous.appointments.map((a) =>
          a.id === appointmentId ? { ...a, status: "cancelled" as const } : a,
        ),
      };
      return addOperation(next, "appointment.cancel", appointmentId);
    });
  }, []);

  const requestEmergencyAppointment = useCallback((input: RequestEmergencyInput): string => {
    const aptId = makeId("apt-emg");
    const queueId = makeId("q-emg");
    const nowTs = Date.now();
    const token = 100 + (state.queue.length + 1);

    const appointment: Appointment = {
      id: aptId,
      patientId: input.patientId,
      patientName: input.patientName,
      patientPhone: input.patientPhone,
      facilityId: input.facilityId,
      facilityName: input.facilityName,
      doctorId: "doc-101",
      doctorName: "Dr. Asha Verma (On Duty Medical Officer)",
      specialty: "Emergency & Critical Triage",
      date: new Date().toISOString().split("T")[0],
      timeSlot: "IMMEDIATE EMERGENCY",
      reason: `[SOS EMERGENCY] ${input.reason}. Symptoms: ${input.symptoms.join(", ")}`,
      isEmergency: true,
      emergencySeverity: input.severity || "critical",
      status: "emergency_dispatched",
      createdAt: nowTs,
      notes: "Emergency alert sent to on-duty medical team. Direct triage active.",
    };

    const emergencyQueue: QueueEntry = {
      id: queueId,
      facilityId: input.facilityId || state.currentUser?.facilityId || "hosp-default",
      patientId: input.patientId,
      service: "🚨 EMERGENCY SOS TRIAGE",
      arrivedAt: nowTs,
      priority: "emergency",
      priorityReason: "vitalConcern",
      status: "called",
      tokenNumber: token,
      roomNumber: "Red Emergency Resuscitation Bay",
      doctorName: "Dr. Asha Verma",
      syncState: "pending",
    };

    setState((previous) => {
      const next = {
        ...previous,
        appointments: [appointment, ...previous.appointments],
        queue: [emergencyQueue, ...previous.queue],
      };
      return addOperation(next, "appointment.emergency", aptId);
    });

    return aptId;
  }, [state.queue.length]);

  const orderMedicine = useCallback((input: OrderMedicineInput): string => {
    const orderId = makeId("ord");
    const nowTs = Date.now();

    const order: MedicineOrder = {
      id: orderId,
      facilityId: input.facilityId || state.currentUser?.facilityId || "hosp-default",
      patientId: input.patientId,
      patientName: input.patientName,
      patientPhone: input.patientPhone,
      facilityName: input.facilityName,
      items: input.items,
      fulfillmentType: input.fulfillmentType,
      status: "pending",
      notes: input.notes,
      createdAt: nowTs,
      updatedAt: nowTs,
    };

    setState((previous) => {
      const next = { ...previous, medicineOrders: [order, ...previous.medicineOrders] };
      return addOperation(next, "medicine.order", orderId);
    });

    return orderId;
  }, []);

  const updateMedicineOrderStatus = useCallback((orderId: string, status: MedicineOrderStatus) => {
    setState((previous) => {
      const next = {
        ...previous,
        medicineOrders: previous.medicineOrders.map((o) =>
          o.id === orderId ? { ...o, status, updatedAt: Date.now() } : o,
        ),
      };
      return addOperation(next, "medicine.orderStatus", orderId);
    });
  }, []);

  const syncNow = useCallback(() => {
    if (syncing) return;
    // Do not attempt server sync while force-offline or network is down
    if (!isOnline) {
      setSyncError("Offline — sync queued until connection is restored.");
      return;
    }
    setSyncing(true);
    setSyncError(null);
    const nowTs = Date.now();

    const finishLocalSync = () => {
      setState((previous) => ({
        ...previous,
        patients: previous.patients.map((item) => ({ ...item, syncState: "synced" as const })),
        queue: previous.queue.map((item) => ({ ...item, syncState: "synced" as const })),
        encounters: previous.encounters.map((item) => ({ ...item, syncState: "synced" as const })),
        referrals: previous.referrals.map((item) => ({ ...item, syncState: "synced" as const })),
        medicines: previous.medicines.map((item) => ({ ...item, syncState: "synced" as const, lastSyncedAt: nowTs })),
        inventoryTransactions: previous.inventoryTransactions.map((item) => ({ ...item, syncState: "synced" as const })),
        beds: previous.beds.map((item) => ({ ...item, syncState: "synced" as const })),
        operations: [],
        lastSyncedAt: nowTs,
      }));
      setSyncing(false);
    };

    if (!transportRef.current || state.operations.length === 0) {
      finishLocalSync();
      return;
    }
    const batch = state.operations.map(serializeOperation);
    transportRef.current(batch)
      .then((result) => {
        // acknowledgedIds are OPERATION IDs (op-xxx), not entity IDs.
        // Build a set of entity IDs whose operations were acknowledged.
        const ackedOpIds = new Set(result.acknowledgedIds);
        const ackedOps = state.operations.filter((op) => ackedOpIds.has(op.id));
        const ackedEntityIds = new Set(ackedOps.map((op) => op.entityId));

        setState((previous) => ({
          ...previous,
          patients: previous.patients.map((item) =>
            ackedEntityIds.has(item.id) ? { ...item, syncState: "synced" as const } : item
          ),
          queue: previous.queue.map((item) =>
            ackedEntityIds.has(item.id) ? { ...item, syncState: "synced" as const } : item
          ),
          encounters: previous.encounters.map((item) =>
            ackedEntityIds.has(item.id) ? { ...item, syncState: "synced" as const } : item
          ),
          referrals: previous.referrals.map((item) =>
            ackedEntityIds.has(item.id) ? { ...item, syncState: "synced" as const } : item
          ),
          medicines: previous.medicines.map((item) =>
            ackedEntityIds.has(item.id) ? { ...item, syncState: "synced" as const, lastSyncedAt: nowTs } : item
          ),
          inventoryTransactions: previous.inventoryTransactions.map((item) =>
            ackedEntityIds.has(item.id) ? { ...item, syncState: "synced" as const } : item
          ),
          beds: previous.beds.map((item) =>
            ackedEntityIds.has(item.id) ? { ...item, syncState: "synced" as const } : item
          ),
          // Remove only the acknowledged operations, keep any that failed
          operations: previous.operations.filter((op) => !ackedOpIds.has(op.id)),
          lastSyncedAt: result.acknowledgedAt || nowTs,
        }));
      })
      .catch((err) => {
        setSyncError(err instanceof Error ? err.message : "Sync failed");
        setSyncing(false);
      })
      .finally(() => setSyncing(false));
  }, [state.operations, syncing]);

  const occupyBed = useCallback((bedId: string, patientId: string, notes?: string) => {
    const bed = state.beds.find((b) => b.id === bedId);
    if (!bed) return;

    setState((previous) => {
      const occupiedTime = Date.now();
      const next = {
        ...previous,
        beds: previous.beds.map((b) =>
          b.id === bedId
            ? { ...b, status: "occupied" as const, occupiedByPatientId: patientId, occupiedSince: occupiedTime, notes, syncState: "pending" as const, updatedAt: occupiedTime }
            : b
        ),
      };
      return addOperation(next, "bed.occupy", bedId, { bedId, patientId, notes });
    });
  }, [state.beds]);

  const releaseBed = useCallback((bedId: string) => {
    setState((previous) => {
      const timestamp = Date.now();
      const next = {
        ...previous,
        beds: previous.beds.map((b) =>
          b.id === bedId
            ? { ...b, status: "available" as const, occupiedByPatientId: undefined, occupiedSince: undefined, syncState: "pending" as const, updatedAt: timestamp }
            : b
        ),
      };
      return addOperation(next, "bed.release", bedId, { bedId });
    });
  }, []);

  const getBedsByUnit = useCallback((unitId: string) => {
    return state.beds.filter((bed) => bed.unitId === unitId);
  }, [state.beds]);

  const getUnitStats = useCallback((unitId: string) => {
    const unit = state.hospitalUnits.find((u) => u.id === unitId);
    if (!unit) return null;

    const beds = state.beds.filter((b) => b.unitId === unitId);
    const occupied = beds.filter((b) => b.status === "occupied").length;
    const available = beds.filter((b) => b.status === "available").length;
    const maintenance = beds.filter((b) => b.status === "maintenance").length;

    return {
      unit,
      totalBeds: unit.totalBeds,
      occupiedBeds: occupied,
      availableBeds: available,
      maintenanceBeds: maintenance,
      occupancyRate: unit.totalBeds > 0 ? (occupied / unit.totalBeds) * 100 : 0,
    };
  }, [state.beds, state.hospitalUnits]);

  const setMaintenanceBed = useCallback((bedId: string, inMaintenance: boolean, notes?: string) => {
    setState((previous) => {
      const timestamp = Date.now();
      const next = {
        ...previous,
        beds: previous.beds.map((b) =>
          b.id === bedId
            ? {
                ...b,
                status: inMaintenance ? ("maintenance" as const) : ("available" as const),
                notes: inMaintenance ? notes : undefined,
                syncState: "pending" as const,
                updatedAt: timestamp,
              }
            : b
        ),
      };
      return addOperation(next, inMaintenance ? "bed.maintenance" : "bed.available", bedId);
    });
  }, []);

  const getNearbyHospitalsWithBeds = useCallback((maxDistance: number = 10) => {
    return state.hospitals
      .filter((h) => h.availableBeds > 0 && h.distanceKm <= maxDistance)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }, [state.hospitals]);

  const getFacilityUnits = useCallback((facilityId: string) => {
    return state.hospitalUnits.filter((unit) => unit.facilityId === facilityId);
  }, [state.hospitalUnits]);

  const getFacilityStats = useCallback((facilityId: string) => {
    const units = state.hospitalUnits.filter((u) => u.facilityId === facilityId);
    const beds = state.beds.filter((b) => units.some((u) => u.id === b.unitId));

    const totalBeds = beds.length;
    const occupiedBeds = beds.filter((b) => b.status === "occupied").length;
    const availableBeds = beds.filter((b) => b.status === "available").length;
    const maintenanceBeds = beds.filter((b) => b.status === "maintenance").length;

    return {
      facilityId,
      totalBeds,
      occupiedBeds,
      availableBeds,
      maintenanceBeds,
      occupancyRate: totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0,
      isFull: availableBeds === 0,
      units: units.map((u) => ({
        ...u,
        totalBeds: u.totalBeds,
        occupiedBeds: beds.filter((b) => b.unitId === u.id && b.status === "occupied").length,
        availableBeds: beds.filter((b) => b.unitId === u.id && b.status === "available").length,
      })),
    };
  }, [state.hospitalUnits, state.beds]);

  const addWard = useCallback((wardName: string, bedCount: number) => {
    if (!state.currentUser || state.currentUser.role !== "chief_doctor") {
      Alert.alert("Permission Denied", "Only the Chief Doctor can add wards.");
      return;
    }
    const timestamp = Date.now();
    const unitId = makeId("unit");
    const unit: HospitalUnit = {
      id: unitId,
      facilityId: state.currentUser.facilityId,
      name: wardName.trim(),
      type: "general_ward",
      totalBeds: bedCount,
      createdAt: timestamp,
      updatedAt: timestamp,
      syncState: "pending",
    };
    const beds: Bed[] = Array.from({ length: bedCount }, (_, i) => ({
      id: makeId(`bed-${i + 1}`),
      unitId,
      bedNumber: `${i + 1}`,
      status: "available" as const,
      createdAt: timestamp,
      updatedAt: timestamp,
      syncState: "pending" as const,
    }));
    setState((previous) => ({
      ...previous,
      hospitalUnits: [unit, ...previous.hospitalUnits],
      beds: [...beds, ...previous.beds],
    }));
  }, [state.currentUser]);

  const syncNowRef = useRef<() => void>(() => undefined);
  syncNowRef.current = syncNow;
  const wasOnlineRef = useRef<boolean | null>(null);
  const cancelRetryRef = useRef<(() => void) | null>(null);

  // ─── Network-aware sync: immediate on reconnect + retry scheduler ────────────
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((netState) => {
      const online = Boolean(netState.isConnected && netState.isInternetReachable !== false);
      const previouslyOnline = wasOnlineRef.current;
      wasOnlineRef.current = online;
      setNetworkOnline(online);

      if (online && previouslyOnline === false) {
        // Back online: sync immediately and restart retry scheduler
        syncNowRef.current();
        if (cancelRetryRef.current) cancelRetryRef.current();
        cancelRetryRef.current = createSyncRetryScheduler(() => syncNowRef.current());
      } else if (!online && previouslyOnline !== false) {
        // Gone offline: stop retry scheduler to save battery
        if (cancelRetryRef.current) {
          cancelRetryRef.current();
          cancelRetryRef.current = null;
        }
      }
    });

    // Initial retry scheduler when the app first loads (handles deferred hydration sync)
    cancelRetryRef.current = createSyncRetryScheduler(() => syncNowRef.current(), 3);

    return () => {
      unsubscribe();
      if (cancelRetryRef.current) cancelRetryRef.current();
    };
  }, []);

  // ─── Periodic background sync every 3 minutes when online ───────────────────
  useEffect(() => {
    if (!isHydrated) return;
    const id = setInterval(() => {
      if (wasOnlineRef.current && state.operations.length > 0) {
        syncNowRef.current();
      }
    }, 3 * 60_000);
    return () => clearInterval(id);
  }, [isHydrated, state.operations.length]);

  const createVaccinationSchedule = useCallback((patientId: string, dob?: Date) => {
    const { currentUser } = state;
    if (!currentUser) return;
    
    // Default to today if no DOB provided
    const baseDate = dob || new Date();
    
    // Helper to add weeks to a date
    const addWeeks = (date: Date, weeks: number) => {
      const result = new Date(date);
      result.setDate(result.getDate() + weeks * 7);
      return result;
    };
    
    const newRecords: VaccinationRecord[] = [
      {
        id: makeId("vac"),
        patientId,
        facilityId: currentUser.facilityId,
        vaccineId: "bcg",
        dueDate: baseDate.toISOString().split("T")[0],
        administered: false,
        notifiedDays: [],
        createdAt: Date.now(),
        syncState: "pending"
      },
      {
        id: makeId("vac"),
        patientId,
        facilityId: currentUser.facilityId,
        vaccineId: "opv0",
        dueDate: baseDate.toISOString().split("T")[0],
        administered: false,
        notifiedDays: [],
        createdAt: Date.now(),
        syncState: "pending"
      },
      {
        id: makeId("vac"),
        patientId,
        facilityId: currentUser.facilityId,
        vaccineId: "hepb0",
        dueDate: baseDate.toISOString().split("T")[0],
        administered: false,
        notifiedDays: [],
        createdAt: Date.now(),
        syncState: "pending"
      },
      {
        id: makeId("vac"),
        patientId,
        facilityId: currentUser.facilityId,
        vaccineId: "dpt1",
        dueDate: addWeeks(baseDate, 6).toISOString().split("T")[0],
        administered: false,
        notifiedDays: [],
        createdAt: Date.now(),
        syncState: "pending"
      }
    ];

    setState((prev) => {
      const next = { ...prev, vaccinationRecords: [...prev.vaccinationRecords, ...newRecords] };
      return addOperation(next, "CREATE_VACCINATION_SCHEDULE", patientId);
    });
  }, [state.currentUser]);

  const markVaccineAdministered = useCallback((recordId: string, doctorName: string) => {
    setState((prev) => {
      const nextRecords = prev.vaccinationRecords.map(r => 
        r.id === recordId 
          ? { ...r, administered: true, administeredAt: Date.now(), administeredBy: doctorName, syncState: "pending" as SyncState }
          : r
      );
      const nextState = { ...prev, vaccinationRecords: nextRecords };
      return addOperation(nextState, "MARK_VACCINE_ADMINISTERED", recordId);
    });
  }, []);

  const value = useMemo<HealthContextValue>(() => ({
    state,
    isHydrated,
    syncing,
    syncError,
    isOnline,
    forceOffline,
    setForceOffline,
    t: (key) => translate(state.language, key),
    priorityLabel: (priority) => priorityLabel(state.language, priority),
    priorityReasonLabel: (reason) => priorityReasonLabel(state.language, reason),
    referralLabel: (status) => referralLabel(state.language, status),
    syncLabel: (syncState) => syncLabel(state.language, syncState),
    setLanguage,
    setCurrentUser,
    registerPatient,
    joinQueue,
    updateQueueStatus,
    overrideQueuePriority,
    addEncounter,
    createReferral,
    updateReferralStatus,
    recordInventoryTransaction,
    addMedicine,
    bookAppointment,
    cancelAppointment,
    requestEmergencyAppointment,
    orderMedicine,
    updateMedicineOrderStatus,
    occupyBed,
    releaseBed,
    getBedsByUnit,
    getUnitStats,
    setMaintenanceBed,
    addWard,
    getNearbyHospitalsWithBeds,
    getFacilityUnits,
    getFacilityStats,
    syncNow,
    getPatient: (patientId) => state.patients.find((patient) => patient.id === patientId && patient.facilityId === state.currentUser?.facilityId),
    getPatientEncounters: (patientId) => state.encounters.filter((encounter) => encounter.patientId === patientId && encounter.facilityId === state.currentUser?.facilityId).sort((a, b) => b.createdAt - a.createdAt),
    getPatientAppointments: (patientId) => state.appointments.filter((a) => a.patientId === patientId && a.facilityId === state.currentUser?.facilityId).sort((a, b) => b.createdAt - a.createdAt),
    getPatientOrders: (patientId) => state.medicineOrders.filter((o) => o.patientId === patientId && o.facilityId === state.currentUser?.facilityId).sort((a, b) => b.createdAt - a.createdAt),
    getPatientActiveQueue: (patientId) => state.queue.find((q) => q.patientId === patientId && q.status !== "completed" && q.facilityId === state.currentUser?.facilityId),
    createVaccinationSchedule,
    markVaccineAdministered,
  }), [addEncounter, addMedicine, bookAppointment, cancelAppointment, createReferral, getFacilityStats, getFacilityUnits, getNearbyHospitalsWithBeds, getBedsByUnit, getUnitStats, isHydrated, isOnline, forceOffline, setForceOffline, joinQueue, occupyBed, orderMedicine, overrideQueuePriority, recordInventoryTransaction, registerPatient, releaseBed, requestEmergencyAppointment, setLanguage, setCurrentUser, setMaintenanceBed, state, syncNow, syncing, syncError, updateMedicineOrderStatus, updateQueueStatus, updateReferralStatus, createVaccinationSchedule, markVaccineAdministered]);

  return <HealthContext.Provider value={value}>{children}</HealthContext.Provider>;
}

export function useHealth() {
  const context = useContext(HealthContext);
  if (!context) throw new Error("useHealth must be used within HealthProvider");
  return context;
}
