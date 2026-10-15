import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from "@nestjs/common";
import type { Request } from "express";
import type { User } from "../../database/entities/user.entity";

/**
 * Guard that validates hospital-level resource access.
 * Ensures users can only access resources belonging to their hospital.
 * 
 * Usage:
 * @UseGuards(JwtAuthGuard, HospitalAccessGuard)
 * @Get()
 * findAll(@Query("hospitalId") hospitalId: string, @Request() req: any) {
 *   // hospitalId is already validated to match req.user.hospitalId
 * }
 */
@Injectable()
export class HospitalAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as User | undefined;

    if (!user) {
      throw new ForbiddenException("Authentication required");
    }

    // Admin users can access all hospitals
    if (user.role === "ADMIN" || user.role === "CHIEF_DOCTOR") {
      return true;
    }

    // Extract hospitalId from various sources
    const hospitalId = this.extractHospitalId(request);

    // If no hospitalId in request, allow (will be filtered by user's hospital)
    if (!hospitalId) {
      return true;
    }

    // Validate hospital ownership
    if (hospitalId !== user.hospitalId) {
      throw new ForbiddenException(
        "You do not have permission to access this hospital's resources"
      );
    }

    return true;
  }

  private extractHospitalId(request: Request): number | null {
    // Check query params
    const queryHospitalId = request.query.hospitalId;
    if (queryHospitalId) {
      const parsed = parseInt(String(queryHospitalId), 10);
      return isNaN(parsed) ? null : parsed;
    }

    // Check body
    const bodyHospitalId = (request.body as any)?.hospitalId;
    if (bodyHospitalId) {
      const parsed = parseInt(String(bodyHospitalId), 10);
      return isNaN(parsed) ? null : parsed;
    }

    // Check params
    const paramsHospitalId = (request.params as any)?.hospitalId;
    if (paramsHospitalId) {
      const parsed = parseInt(String(paramsHospitalId), 10);
      return isNaN(parsed) ? null : parsed;
    }

    return null;
  }
}

/**
 * Role-based access control guard
 * Restricts access to specific roles
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly allowedRoles: string[]) { }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as User | undefined;

    if (!user) {
      throw new ForbiddenException("Authentication required");
    }

    if (!this.allowedRoles.includes(user.role)) {
      throw new ForbiddenException(
        `This action requires one of the following roles: ${this.allowedRoles.join(", ")}`
      );
    }

    return true;
  }
}
