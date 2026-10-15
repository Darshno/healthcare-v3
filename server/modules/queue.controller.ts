import { Controller, Post, Get, Param, Body, UseGuards, Query, Res, Logger, ForbiddenException, Request } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Response } from "express";
import { PatientQueueService } from "../queue/patient-queue.service";
import { TriageQueueService } from "../queue/triage-queue.service";
import { QueueRealtimeService } from "../queue/queue-realtime.service";
import { CacheService } from "../redis/cache.service";
import { TriageResult } from "../database/entities";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { HospitalAccessGuard } from "../_core/auth/hospital-auth.guard";
import type { User } from "../database/entities";

@Controller("api/queue")
@UseGuards(JwtAuthGuard, HospitalAccessGuard)
export class QueueController {
  private readonly logger = new Logger(QueueController.name);

  constructor(
    private readonly patientQueue: PatientQueueService,
    private readonly realtime: QueueRealtimeService,
    private readonly cache: CacheService,
  ) { }

  /**
   * SECURITY: Validates hospital ownership before enqueueing
   */
  private validateHospitalAccess(user: User, hospitalId: number): void {
    if (user.role === "ADMIN" || user.role === "CHIEF_DOCTOR") {
      return; // Admins can access any hospital
    }
    if (user.hospitalId !== hospitalId) {
      throw new ForbiddenException("You can only manage queues in your own hospital");
    }
  }

  @Post("enqueue")
  async enqueue(
    @Body()
    body: {
      hospitalId: number;
      patientId: number;
      serviceType: string;
      careCategory: "emergency" | "urgent" | "priority" | "routine";
      priorityReason?: string;
    },
    @Request() req?: any,
  ) {
    // SECURITY: Validate hospital ownership
    if (req) {
      this.validateHospitalAccess(req.user as User, body.hospitalId);
    }

    const job = await this.patientQueue.enqueue(body);
    return { jobId: job.id, status: "queued" };
  }

  @Post("call-next/:hospitalId")
  async callNext(
    @Param("hospitalId") hospitalId: string,
    @Query("serviceType") serviceType?: string,
    @Request() req?: any,
  ) {
    // SECURITY: Validate hospital ownership
    if (req) {
      this.validateHospitalAccess(req.user as User, Number(hospitalId));
    }

    const job = await this.patientQueue.callNext(Number(hospitalId), serviceType);
    return { jobId: job.id, status: "calling" };
  }

  @Post("call/:hospitalId/:patientId")
  async call(
    @Param("hospitalId") hospitalId: string,
    @Param("patientId") patientId: string,
    @Request() req?: any,
  ) {
    // SECURITY: Validate hospital ownership
    if (req) {
      this.validateHospitalAccess(req.user as User, Number(hospitalId));
    }

    const job = await this.patientQueue.call(Number(hospitalId), Number(patientId));
    return { jobId: job.id, status: "calling" };
  }

  @Post("complete/:hospitalId/:patientId")
  async complete(
    @Param("hospitalId") hospitalId: string,
    @Param("patientId") patientId: string,
    @Request() req?: any,
  ) {
    // SECURITY: Validate hospital ownership
    if (req) {
      this.validateHospitalAccess(req.user as User, Number(hospitalId));
    }

    const job = await this.patientQueue.complete(Number(hospitalId), Number(patientId));
    return { jobId: job.id, status: "completed" };
  }

  @Post("transfer/:hospitalId/:patientId")
  async transfer(
    @Param("hospitalId") hospitalId: string,
    @Param("patientId") patientId: string,
    @Body() body: { targetHospitalId: number },
    @Request() req?: any,
  ) {
    // SECURITY: Validate hospital ownership
    if (req) {
      this.validateHospitalAccess(req.user as User, Number(hospitalId));
    }

    const job = await this.patientQueue.transfer(
      Number(hospitalId),
      Number(patientId),
      body.targetHospitalId,
    );
    return { jobId: job.id, status: "transferring" };
  }

  @Post("pause/:hospitalId/:patientId")
  async pause(
    @Param("hospitalId") hospitalId: string,
    @Param("patientId") patientId: string,
    @Request() req?: any,
  ) {
    // SECURITY: Validate hospital ownership
    if (req) {
      this.validateHospitalAccess(req.user as User, Number(hospitalId));
    }

    const job = await this.patientQueue.pause(Number(hospitalId), Number(patientId));
    return { jobId: job.id, status: "paused" };
  }

  /**
   * Current queue snapshot for a hospital (from the fast cache store).
   * Used by the doctor portal to render the board and by SSE clients on connect.
   */
  @Get(":hospitalId")
  async hospitalQueue(@Param("hospitalId") hospitalId: string) {
    const hospital = Number(hospitalId);
    const hash = (await this.cache.getAllHash(`queue:hospital:${hospital}`)) ?? {};
    const entries = Object.values(hash).filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
    const priorityOrder = ["emergency", "urgent", "priority", "routine"];
    entries.sort((a, b) => {
      const pA = priorityOrder.indexOf(String(a.careCategory));
      const pB = priorityOrder.indexOf(String(b.careCategory));
      if (pA !== pB) return pA - pB;
      return Number(a.enteredAt ?? 0) - Number(b.enteredAt ?? 0);
    });
    return {
      hospitalId: hospital,
      entries: entries.map((entry) => ({ ...entry, hospitalId: hospital })),
    };
  }

  /**
   * Server-Sent Events stream of live queue updates for a hospital.
   * Emits an initial snapshot, then each subsequent queue event.
   */
  @Get("events/:hospitalId")
  async streamHospitalQueue(
    @Param("hospitalId") hospitalId: string,
    @Res() res: Response,
  ) {
    const hospital = Number(hospitalId);

    res.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Initial snapshot from the fast in-memory/Redis store.
    const snapshot = (await this.cache.getAllHash<Record<string, unknown>>(`queue:hospital:${hospital}`)) ?? {};
    send("snapshot", { hospitalId: hospital, entries: snapshot });

    const unsubscribe = this.realtime.subscribe(hospital, (event) => {
      send("queue.update", event);
    });

    // Heartbeat every 25s to keep proxies from dropping the connection.
    const heartbeat = setInterval(() => {
      res.write(": ping\n\n");
    }, 25000);

    res.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }
}

@Controller("api/triage")
@UseGuards(JwtAuthGuard)
export class TriageController {
  constructor(
    private readonly triageQueue: TriageQueueService,
    @InjectRepository(TriageResult) private readonly triageRepo: Repository<TriageResult>,
  ) { }

  @Post("assess")
  async assess(
    @Body()
    body: {
      patientId: number;
      hospitalId: number;
      serviceType: string;
      screeningData: Record<string, unknown>;
      symptomText?: string;
      clinicianOverride?: {
        careCategory: string;
        reason: string;
      };
    },
  ) {
    const job = await this.triageQueue.assess(body);
    return { jobId: job.id, status: "assessing" };
  }

  @Get("results/:hospitalId")
  async getResults(
    @Param("hospitalId") hospitalId: string,
    @Query("patientId") patientId?: string,
  ) {
    const where: any = { hospitalId: Number(hospitalId) };
    if (patientId) where.patientId = Number(patientId);
    return this.triageRepo.find({
      where,
      order: { assessedAt: "DESC" },
      take: 100,
    });
  }
}
