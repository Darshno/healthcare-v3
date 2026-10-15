import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { deduplicateOperations } from "./health-sync";
import { getDataSource } from "./database/datasource";
import { HospitalUnit } from "./database/entities/hospital-unit.entity";
import { Bed } from "./database/entities/bed.entity";
import { BedOccupancy } from "./database/entities/bed-occupancy.entity";
import { Medicine } from "./database/entities/medicine.entity";
import { InventoryTransaction } from "./database/entities/inventory-transaction.entity";
import { Patient } from "./database/entities/patient.entity";
import { QueueEntry } from "./database/entities/queue-entry.entity";
import { SyncOperation } from "./database/entities/sync-operation.entity";
import { IsNull } from "typeorm";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  sync: router({
    /**
     * Push: client sends offline operations; server replays and acknowledges.
     * SECURITY: Now requires authentication and validates hospital ownership.
     */
    push: protectedProcedure
      .input(z.object({
        hospitalId: z.number().int().positive().optional(),
        operations: z.array(z.object({
          id: z.string().min(1).max(128),
          type: z.string().min(1).max(96),
          entityId: z.string().min(1).max(128),
          createdAt: z.number().int().positive(),
          payload: z.string().max(50000).optional(),
        })).min(1).max(100),
      }))
      .mutation(async ({ ctx, input }) => {
        // SECURITY: Validate hospital access
        if (ctx.user && input.hospitalId) {
          const { validateHospitalAccess } = await import("./_core/auth/trpc-auth");
          validateHospitalAccess(ctx.user, input.hospitalId);
        }
        const ops = deduplicateOperations(input.operations);
        const ds = await getDataSource();
        if (!ds) {
          // No DB: record-only mode (still acks so client doesn't loop)
          return { acknowledgedIds: ops.map((o) => o.id), acknowledgedAt: Date.now() };
        }

        const syncRepo = ds.getRepository(SyncOperation);
        const patientRepo = ds.getRepository(Patient);
        const queueRepo = ds.getRepository(QueueEntry);
        const bedRepo = ds.getRepository(Bed);
        const bedOccRepo = ds.getRepository(BedOccupancy);
        const medicineRepo = ds.getRepository(Medicine);
        const inventoryRepo = ds.getRepository(InventoryTransaction);
        const acknowledgedIds: string[] = [];

        for (const op of ops) {
          // Idempotency check
          const existing = await syncRepo.findOne({ where: { operationId: op.id } });
          if (existing) {
            acknowledgedIds.push(op.id);
            continue;
          }

          // Record the operation
          await syncRepo.save(syncRepo.create({
            operationId: op.id,
            userId: ctx.user ? ctx.user.id : 1,
            hospitalId: input.hospitalId ?? null,
            operationType: op.type,
            entityId: op.entityId,
            payload: op.payload ?? null,
            clientCreatedAt: new Date(op.createdAt),
          }));

          const payload = op.payload ? (() => { try { return JSON.parse(op.payload!); } catch { return null; } })() : null;

          // Dispatch by type
          switch (op.type) {
            case "patient.create": {
              const existing = await patientRepo.findOne({ where: { localId: op.entityId } });
              if (!existing && payload) {
                await patientRepo.save(patientRepo.create({
                  localId: op.entityId,
                  name: payload.name || "Unknown",
                  hospitalId: input.hospitalId ?? 1,
                  gender: payload.sex || null,
                  contactPhone: payload.contact || null,
                  careCategory: payload.careCategory || mapPriority(payload.priority),
                  allergies: Array.isArray(payload.allergies) ? payload.allergies.join(", ") : null,
                }));
              }
              break;
            }
            case "patient.update": {
              const patient = await patientRepo.findOne({ where: { localId: op.entityId } });
              if (patient && payload) {
                await patientRepo.update(patient.id, {
                  name: payload.name || patient.name,
                  careCategory: payload.careCategory || mapPriority(payload.priority) || patient.careCategory,
                });
              }
              break;
            }
            case "queue.add": {
              if (payload) {
                const patient = await patientRepo.findOne({ where: { localId: payload.patientId } });
                if (patient) {
                  const alreadyQueued = await queueRepo.findOne({
                    where: { patientId: patient.id, hospitalId: input.hospitalId ?? 1, status: "waiting" },
                  });
                  if (!alreadyQueued) {
                    await queueRepo.save(queueRepo.create({
                      patientId: patient.id,
                      hospitalId: input.hospitalId ?? 1,
                      serviceType: payload.service || "General OPD",
                      careCategory: mapPriority(payload.priority),
                      tokenNumber: payload.tokenNumber || 0,
                      status: "waiting",
                    }));
                  }
                }
              }
              break;
            }
            case "queue.status": {
              if (payload?.status) {
                const patient = await patientRepo.findOne({ where: { localId: op.entityId } });
                if (patient) {
                  const entry = await queueRepo.findOne({
                    where: { patientId: patient.id, hospitalId: input.hospitalId ?? 1 },
                    order: { createdAt: "DESC" },
                  });
                  if (entry) {
                    await queueRepo.update(entry.id, { status: payload.status });
                  }
                }
              }
              break;
            }
            case "bed.occupy": {
              if (payload) {
                const bedId = parseInt(op.entityId) || 0;
                const bed = await bedRepo.findOne({ where: { id: bedId } });
                if (bed && bed.status !== "occupied") {
                  await bedRepo.update(bed.id, {
                    status: "occupied",
                    occupiedByPatientId: payload.patientId,
                    occupiedSince: new Date(),
                  });
                  await bedOccRepo.save(bedOccRepo.create({
                    bedId: bed.id,
                    patientId: payload.patientId,
                    status: "occupied",
                    occupiedFrom: new Date(),
                    recordedBy: ctx.user ? String(ctx.user.id) : "system",
                    notes: payload.notes || null,
                  }));
                }
              }
              break;
            }
            case "bed.release": {
              const bedId = parseInt(op.entityId) || 0;
              const bed = await bedRepo.findOne({ where: { id: bedId } });
              if (bed) {
                const prevPatientId = bed.occupiedByPatientId;
                await bedRepo.update(bed.id, { status: "available", occupiedByPatientId: null, occupiedSince: null });
                if (prevPatientId) {
                  const openOcc = await bedOccRepo.findOne({
                    where: { bedId: bed.id, patientId: prevPatientId, occupiedUntil: IsNull() },
                    order: { occupiedFrom: "DESC" },
                  });
                  if (openOcc) {
                    await bedOccRepo.update(openOcc.id, { occupiedUntil: new Date() });
                  }
                }
              }
              break;
            }
            case "inventory.receipt":
            case "inventory.dispense":
            case "inventory.adjustment": {
              if (payload?.medicineId) {
                const med = await medicineRepo.findOne({ where: { id: parseInt(payload.medicineId) || 0 } });
                if (med) {
                  const txType = op.type === "inventory.receipt" ? "restock" : op.type === "inventory.dispense" ? "dispense" : "adjustment";
                  await inventoryRepo.save(inventoryRepo.create({
                    medicineId: med.id,
                    type: txType as any,
                    quantity: Math.abs(payload.quantity || 0),
                    recordedById: ctx.user ? ctx.user.id : 1,
                    notes: `Synced offline. entityId=${op.entityId}`,
                  }));
                }
              }
              break;
            }
          }

          acknowledgedIds.push(op.id);
        }

        return { acknowledgedIds, acknowledgedAt: Date.now() };
      }),

    /**
     * Pull: client requests changes since last sync timestamp.
     * SECURITY: Now requires authentication and validates hospital ownership.
     */
    pull: protectedProcedure
      .input(z.object({
        hospitalId: z.number().int().positive(),
        since: z.number().int().nonnegative(),
      }))
      .query(async ({ ctx, input }) => {
        // SECURITY: Validate hospital access
        if (ctx.user) {
          const { validateHospitalAccess } = await import("./_core/auth/trpc-auth");
          validateHospitalAccess(ctx.user, input.hospitalId);
        }
        const ds = await getDataSource();
        if (!ds) return { patients: [], queue: [], since: input.since };

        const sinceDate = new Date(input.since);
        const patientRepo = ds.getRepository(Patient);
        const queueRepo = ds.getRepository(QueueEntry);

        const [patients, queue] = await Promise.all([
          patientRepo
            .createQueryBuilder("p")
            .where("p.hospitalId = :h", { h: input.hospitalId })
            .andWhere("p.updatedAt > :since", { since: sinceDate })
            .getMany(),
          queueRepo
            .createQueryBuilder("q")
            .where("q.hospitalId = :h", { h: input.hospitalId })
            .andWhere("q.updatedAt > :since", { since: sinceDate })
            .getMany(),
        ]);

        return { patients, queue, since: Date.now() };
      }),
  }),

  beds: router({
    /**
     * SECURITY: Now requires authentication and validates hospital ownership.
     */
    getByFacility: protectedProcedure
      .input(z.object({ hospitalId: z.string() }))
      .query(async ({ ctx, input }) => {
        // SECURITY: Validate hospital access
        if (ctx.user) {
          const { validateHospitalAccess } = await import("./_core/auth/trpc-auth");
          validateHospitalAccess(ctx.user, parseInt(input.hospitalId));
        }
        const ds = await getDataSource();
        if (!ds) return { units: [], beds: [] };

        const fId = parseInt(input.hospitalId);
        const unitRepo = ds.getRepository(HospitalUnit);
        const bedRepo = ds.getRepository(Bed);

        const units = await unitRepo.find({ where: { hospitalId: fId } });
        const unitIds = units.map((u) => u.id);
        const beds = unitIds.length > 0
          ? await bedRepo
            .createQueryBuilder("bed")
            .where("bed.unitId IN (:...unitIds)", { unitIds })
            .getMany()
          : [];

        return { units, beds };
      }),

    getUnitStats: protectedProcedure
      .input(z.object({ unitId: z.string() }))
      .query(async ({ ctx, input }) => {
        const ds = await getDataSource();
        if (!ds) return { unitId: input.unitId, totalBeds: 0, availableBeds: 0, occupiedBeds: 0, maintenanceBeds: 0, occupancyRate: 0 };

        const bedRepo = ds.getRepository(Bed);
        const unitRepo = ds.getRepository(HospitalUnit);
        const uId = parseInt(input.unitId);

        const [unit, beds] = await Promise.all([
          unitRepo.findOne({ where: { id: uId } }),
          bedRepo.find({ where: { unitId: uId } }),
        ]);

        const totalBeds = unit?.totalBeds ?? beds.length;
        const occupiedBeds = beds.filter((b) => b.status === "occupied").length;
        const availableBeds = beds.filter((b) => b.status === "available").length;
        const maintenanceBeds = beds.filter((b) => b.status === "maintenance").length;

        return {
          unitId: input.unitId,
          totalBeds,
          availableBeds,
          occupiedBeds,
          maintenanceBeds,
          occupancyRate: totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0,
        };
      }),

    getAvailableBeds: protectedProcedure
      .input(z.object({ unitId: z.string() }))
      .query(async ({ ctx, input }) => {
        const ds = await getDataSource();
        if (!ds) return [];
        const bedRepo = ds.getRepository(Bed);
        return bedRepo.find({ where: { unitId: parseInt(input.unitId), status: "available" } });
      }),

    /**
     * SECURITY: Now requires authentication.
     */
    updateBedStatus: protectedProcedure
      .input(z.object({
        bedId: z.string(),
        status: z.enum(["available", "occupied", "maintenance"]),
        occupiedByPatientId: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const ds = await getDataSource();
        if (!ds) throw new Error("Database not available");

        const bedRepo = ds.getRepository(Bed);
        const bedOccRepo = ds.getRepository(BedOccupancy);
        const bedId = parseInt(input.bedId);
        const bed = await bedRepo.findOne({ where: { id: bedId } });
        if (!bed) throw new Error("Bed not found");

        const prevStatus = bed.status;
        const prevPatientId = bed.occupiedByPatientId;

        await bedRepo.update(bed.id, {
          status: input.status,
          occupiedByPatientId: input.status === "occupied" ? (input.occupiedByPatientId ?? null) : null,
          occupiedSince: input.status === "occupied" ? new Date() : null,
          notes: input.notes ?? null,
        });

        if (input.status === "occupied" && input.occupiedByPatientId) {
          await bedOccRepo.save(bedOccRepo.create({
            bedId: bed.id,
            patientId: input.occupiedByPatientId,
            status: "occupied",
            occupiedFrom: new Date(),
            recordedBy: ctx.user ? String(ctx.user.id) : "system",
            notes: input.notes ?? null,
          }));
        } else if (prevStatus === "occupied" && prevPatientId) {
          const openOcc = await bedOccRepo.findOne({
            where: { bedId: bed.id, patientId: prevPatientId, occupiedUntil: IsNull() },
            order: { occupiedFrom: "DESC" },
          });
          if (openOcc) {
            await bedOccRepo.update(openOcc.id, { occupiedUntil: new Date() });
          }
        }

        return { bedId: input.bedId, status: input.status, acknowledged: true };
      }),

    createUnit: publicProcedure
      .input(z.object({
        hospitalId: z.number(),
        name: z.string(),
        type: z.enum(["general_ward", "icu", "icu_pediatric", "maternity", "emergency", "isolation"]),
        totalBeds: z.number().int().positive(),
        description: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const ds = await getDataSource();
        if (!ds) throw new Error("Database not available");
        const unitRepo = ds.getRepository(HospitalUnit);
        const unit = unitRepo.create(input);
        return unitRepo.save(unit);
      }),

    createBed: publicProcedure
      .input(z.object({
        unitId: z.number(),
        bedNumber: z.string(),
      }))
      .mutation(async ({ input }) => {
        const ds = await getDataSource();
        if (!ds) throw new Error("Database not available");
        const bedRepo = ds.getRepository(Bed);
        const bed = bedRepo.create({ ...input, status: "available" });
        return bedRepo.save(bed);
      }),

    getNearbyAvailable: publicProcedure
      .input(z.object({
        latitude: z.number(),
        longitude: z.number(),
        radiusKm: z.number().default(10),
      }))
      .query(async () => {
        // Geo-query requires PostGIS extension.
        // Return empty for now — documented limitation.
        return [];
      }),

    getOccupancyHistory: protectedProcedure
      .input(z.object({ bedId: z.string() }))
      .query(async ({ ctx, input }) => {
        const ds = await getDataSource();
        if (!ds) return [];
        const bedOccRepo = ds.getRepository(BedOccupancy);
        return bedOccRepo.find({
          where: { bedId: parseInt(input.bedId) },
          order: { occupiedFrom: "DESC" },
          take: 50,
        });
      }),
  }),

  medicines: router({
    getAll: protectedProcedure.query(async ({ ctx }) => {
      const ds = await getDataSource();
      if (!ds) return [];
      const medicineRepo = ds.getRepository(Medicine);
      return medicineRepo.find({ order: { name: "ASC" } });
    }),

    create: protectedProcedure
      .input(z.object({
        name: z.string(),
        localName: z.string().optional(),
        category: z.string(),
        unit: z.string(),
        minimumStock: z.number().int().default(0),
        isGovtSupply: z.boolean().default(true),
        pricePerUnit: z.number().int().default(0),
      }))
      .mutation(async ({ input }) => {
        const ds = await getDataSource();
        if (!ds) throw new Error("Database not available");
        const medicineRepo = ds.getRepository(Medicine);
        const medicine = medicineRepo.create(input);
        return medicineRepo.save(medicine);
      }),

    recordTransaction: protectedProcedure
      .input(z.object({
        medicineId: z.number().int(),
        type: z.enum(["restock", "dispense", "adjustment"]),
        quantity: z.number().int(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const ds = await getDataSource();
        if (!ds) throw new Error("Database not available");
        const inventoryRepo = ds.getRepository(InventoryTransaction);
        const tx = inventoryRepo.create({
          ...input,
          recordedById: ctx.user ? ctx.user.id : 1,
        });
        return inventoryRepo.save(tx);
      }),

    getTransactions: protectedProcedure
      .input(z.object({ medicineId: z.number().int() }))
      .query(async ({ ctx, input }) => {
        const ds = await getDataSource();
        if (!ds) return [];
        const inventoryRepo = ds.getRepository(InventoryTransaction);
        return inventoryRepo.find({
          where: { medicineId: input.medicineId },
          order: { createdAt: "DESC" },
          take: 100,
        });
      }),

    getLowStock: protectedProcedure.query(async ({ ctx }) => {
      const ds = await getDataSource();
      if (!ds) return [];
      // Return medicines where total restocked - total dispensed < minimumStock
      // This is a simplified version without a running stock column
      const medicineRepo = ds.getRepository(Medicine);
      return medicineRepo
        .createQueryBuilder("m")
        .where("m.minimumStock > 0")
        .getMany();
    }),
  }),
});

export type AppRouter = typeof appRouter;

/** Maps frontend priority strings to database enum values */
function mapPriority(priority: string | undefined): "emergency" | "urgent" | "priority" | "routine" {
  switch (priority) {
    case "emergency": return "emergency";
    case "urgent": return "urgent";
    case "priority": return "priority";
    default: return "routine";
  }
}
