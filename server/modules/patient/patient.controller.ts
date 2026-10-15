import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
} from "@nestjs/common";
import { PatientService } from "./patient.service";
import { SyncService } from "./sync.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { HospitalAccessGuard } from "../../_core/auth/hospital-auth.guard";
import type { User } from "../../database/entities";

@Controller("api/patients")
@UseGuards(JwtAuthGuard, HospitalAccessGuard)
export class PatientController {
  constructor(
    private readonly patientService: PatientService,
    private readonly syncService: SyncService,
  ) { }

  @Get()
  async findAll(
    @Query("hospitalId") hospitalId: string,
    @Query("careCategory") careCategory?: string,
    @Query("search") search?: string,
    @Request() req?: any,
  ) {
    // SECURITY: Validate hospital ownership
    const user = req.user as User;
    const requestedHospitalId = Number(hospitalId);

    // Non-admin users can only see their own hospital's patients
    if (user.role !== "ADMIN" && user.role !== "CHIEF_DOCTOR" && user.hospitalId !== requestedHospitalId) {
      throw new ForbiddenException("You can only access patients from your own hospital");
    }

    return this.patientService.findByHospital(requestedHospitalId, { careCategory, search });
  }

  @Get(":id")
  async findOne(@Param("id") id: number, @Request() req?: any) {
    const patient = await this.patientService.findById(Number(id));

    // SECURITY: Validate hospital ownership
    if (patient && req) {
      const user = req.user as User;
      if (user.role !== "ADMIN" && user.role !== "CHIEF_DOCTOR" && patient.hospitalId !== user.hospitalId) {
        throw new ForbiddenException("You do not have permission to access this patient");
      }
    }

    return patient;
  }

  @Post()
  async create(@Body() body: any, @Request() req?: any) {
    // SECURITY: Validate hospital ownership
    const user = req?.user as User;
    if (user && body.hospitalId) {
      if (user.role !== "ADMIN" && user.role !== "CHIEF_DOCTOR" && user.hospitalId !== body.hospitalId) {
        throw new ForbiddenException("You can only create patients in your own hospital");
      }
    }

    return this.patientService.create(body);
  }

  @Put(":id")
  async update(@Param("id") id: number, @Body() body: any, @Request() req?: any) {
    // SECURITY: Validate hospital ownership
    const user = req?.user as User;
    const patient = await this.patientService.findById(Number(id));

    if (patient && user) {
      if (user.role !== "ADMIN" && user.role !== "CHIEF_DOCTOR" && patient.hospitalId !== user.hospitalId) {
        throw new ForbiddenException("You do not have permission to update this patient");
      }
    }

    return this.patientService.update(Number(id), body);
  }
}

@Controller("api/sync")
export class SyncController {
  constructor(private readonly syncService: SyncService) { }

  @UseGuards(JwtAuthGuard)
  @Post("push")
  async push(
    @Request() req: any,
    @Body()
    body: {
      hospitalId?: number;
      operations: Array<{
        id: string;
        type: string;
        entityId: string;
        createdAt: number;
        payload?: string;
      }>;
    },
  ) {
    return this.syncService.pushOperations({
      userId: req.user.id,
      hospitalId: body.hospitalId,
      operations: body.operations,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get("pull")
  async pull(
    @Query("hospitalId") hospitalId: string,
    @Query("since") since: string,
  ) {
    return this.syncService.getOperationsSince(
      Number(hospitalId),
      new Date(since),
    );
  }
}
