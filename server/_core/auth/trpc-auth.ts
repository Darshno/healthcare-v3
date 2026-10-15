import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../context";
import type { User } from "../../database/entities";

/**
 * Validates that the authenticated user has access to the specified hospital.
 * Admin and chief doctors can access any hospital.
 * Regular users can only access their own hospital.
 */
export function validateHospitalAccess(
  user: User,
  requestedHospitalId: number | undefined | null
): void {
  if (!requestedHospitalId) return;

  // Admin and chief doctors can access any hospital
  if (user.role === "ADMIN" || user.role === "CHIEF_DOCTOR") {
    return;
  }

  // Regular users can only access their own hospital
  if (user.hospitalId !== requestedHospitalId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to access this hospital's resources",
    });
  }
}

/**
 * Validates that a patient belongs to the user's hospital.
 * Throws FORBIDDEN if patient belongs to a different hospital.
 */
export async function validatePatientHospitalOwnership(
  ctx: TrpcContext,
  patientId: number,
  patientRepo: any
): Promise<void> {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }

  const patient = await patientRepo.findOne({
    where: { id: patientId },
    select: ["id", "hospitalId"],
  });

  if (!patient) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Patient not found",
    });
  }

  // Admin and chief doctors can access any patient
  if (ctx.user.role === "ADMIN" || ctx.user.role === "CHIEF_DOCTOR") {
    return;
  }

  // Regular users can only access patients from their hospital
  if (patient.hospitalId !== ctx.user.hospitalId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to access this patient",
    });
  }
}

/**
 * Role hierarchy for authorization checks
 */
const ROLE_HIERARCHY: Record<string, number> = {
  PATIENT: 0,
  ASHA_WORKER: 1,
  RECEPTIONIST: 2,
  DOCTOR: 3,
  CHIEF_DOCTOR: 4,
  ADMIN: 5,
};

/**
 * Validates that the user has at least the required role.
 */
export function requireRole(
  user: User | null,
  minimumRole: keyof typeof ROLE_HIERARCHY
): void {
  if (!user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }

  const userLevel = ROLE_HIERARCHY[user.role] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[minimumRole] ?? 0;

  if (userLevel < requiredLevel) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `This action requires role '${minimumRole}' or higher`,
    });
  }
}
