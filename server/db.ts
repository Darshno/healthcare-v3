import { getDataSource } from "./database/datasource";
import { User, SyncOperation } from "./database/entities";
import { ENV } from "./_core/env";

export type InsertUser = {
  openId: string;
  name?: string | null;
  email?: string | null;
  loginMethod?: string | null;
  role?: "PATIENT" | "ASHA_WORKER" | "RECEPTIONIST" | "DOCTOR" | "CHIEF_DOCTOR" | "ADMIN" | "chief_doc" | "doctor" | "asha" | "receptionist" | "admin";
  hospitalId?: number;
  lastSignedIn?: Date;
  passwordHash?: string | null;
};

export async function getUserByOpenId(openId: string): Promise<User | undefined> {
  const ds = await getDataSource();
  if (!ds) return undefined;

  const repo = ds.getRepository(User);
  const user = await repo.findOne({ where: { openId } });
  return user ?? undefined;
}

export async function upsertUser(user: InsertUser): Promise<User | undefined> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const ds = await getDataSource();
  if (!ds) return undefined;

  const repo = ds.getRepository(User);
  let existing = await repo.findOne({ where: { openId: user.openId } });

  if (!existing) {
    existing = repo.create({
      openId: user.openId,
      hospitalId: user.hospitalId ?? 1,
      name: user.name ?? null,
      email: user.email ?? null,
      loginMethod: user.loginMethod ?? null,
      passwordHash: user.passwordHash ?? null,
      // SECURITY: Default to PATIENT role, not DOCTOR
      role: (user.role as any) ?? (user.openId === ENV.ownerOpenId ? "ADMIN" : "PATIENT"),
      lastSignedIn: user.lastSignedIn ?? new Date(),
    });
  } else {
    if (user.name !== undefined) existing.name = user.name;
    if (user.email !== undefined) existing.email = user.email;
    if (user.loginMethod !== undefined) existing.loginMethod = user.loginMethod;
    if (user.hospitalId !== undefined) existing.hospitalId = user.hospitalId;
    if (user.passwordHash !== undefined) existing.passwordHash = user.passwordHash;
    if (user.role !== undefined) existing.role = user.role as any;
    if (user.lastSignedIn !== undefined) existing.lastSignedIn = user.lastSignedIn;
  }

  return await repo.save(existing);
}

export async function recordSyncOperations(input: {
  userId: number;
  hospitalId?: number;
  operations: Array<{ id: string; type: string; entityId: string; createdAt: number; payload?: string; deviceId?: string; version?: number }>;
}) {
  const ds = await getDataSource();
  if (!ds) throw new Error("Database not available");

  const repo = ds.getRepository(SyncOperation);

  for (const op of input.operations) {
    let existing = await repo.findOne({ where: { operationId: op.id } });
    if (!existing) {
      existing = repo.create({
        operationId: op.id,
        userId: input.userId,
        hospitalId: input.hospitalId ?? null,
        operationType: op.type,
        entityId: op.entityId,
        payload: op.payload ?? null,
        deviceId: op.deviceId ?? null,
        version: op.version ?? 1,
        clientCreatedAt: new Date(op.createdAt),
      });
      await repo.save(existing);
    }
  }

  return input.operations.map((op) => op.id);
}
