import { Injectable, Logger, UnauthorizedException, BadRequestException, Optional } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { scryptSync, randomBytes, timingSafeEqual, createHash } from "crypto";
import { SignJWT } from "jose";
import { User } from "../../database/entities";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password: string, hash: string): boolean {
  const parts = hash.split(":");
  if (parts.length !== 2) return false;
  const [salt, key] = parts;
  const keyBuffer = Buffer.from(key, "hex");
  const derivedKey = scryptSync(password, salt, 64);
  return timingSafeEqual(keyBuffer, derivedKey);
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "").replace(/^00/, "+");
}

function normalizeRole(role: unknown): User["role"] {
  const roleMap: Record<string, User["role"]> = {
    chief_doctor: "CHIEF_DOCTOR",
    chief_doc: "CHIEF_DOCTOR",
    doctor: "DOCTOR",
    asha_worker: "ASHA_WORKER",
    asha: "ASHA_WORKER",
    receptionist: "RECEPTIONIST",
    admin: "ADMIN",
    patient: "PATIENT",
  };
  const normalized = typeof role === "string" ? roleMap[role.toLowerCase()] : undefined;
  return normalized ?? "DOCTOR";
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly localUsers = new Map<string, User>();
  private nextLocalId = 1;

  constructor(
    @Optional()
    @InjectRepository(User)
    private readonly userRepo: Repository<User> | undefined,
    private readonly jwtService: JwtService,
  ) { }

  async register(data: {
    openId: string;
    name?: string;
    password?: string;
    role?: any;
    hospitalId?: number;
    email?: string;
    phone?: string;
  }): Promise<{ accessToken: string; user: User }> {
    // SECURITY: Validate required password
    if (!data.password || data.password.trim().length < 8) {
      throw new BadRequestException("Password must be at least 8 characters");
    }

    // SECURITY: Validate required fields
    if (!data.openId || data.openId.trim().length === 0) {
      throw new BadRequestException("OpenID is required");
    }

    const normalizedPhone = data.phone ? normalizePhone(data.phone) : null;
    if (!this.userRepo) {
      const existing = this.localUsers.get(data.openId);
      if (existing) throw new BadRequestException(`User with identifier "${data.openId}" already exists`);
      const localUser = this.createLocalUser(data, normalizedPhone, data.password);
      this.localUsers.set(localUser.openId, localUser);
      return { accessToken: await this.generateJwt(localUser), user: localUser };
    }

    let existing = await this.userRepo.findOne({
      where: [
        { openId: data.openId },
        ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
        ...(data.email ? [{ email: data.email.trim().toLowerCase() }] : []),
      ],
    });
    if (existing) {
      throw new BadRequestException(`User with identifier "${data.openId}" already exists`);
    }

    let passwordHash: string | null = null;
    if (data.password && data.password.trim().length > 0) {
      passwordHash = hashPassword(data.password.trim());
    }

    const user = this.userRepo.create({
      openId: data.openId,
      name: data.name || data.openId,
      passwordHash,
      role: normalizeRole(data.role),
      hospitalId: data.hospitalId || 1,
      email: data.email || null,
      phone: normalizedPhone,
      lastSignedIn: new Date(),
    });

    const savedUser = await this.userRepo.save(user);
    const token = await this.generateJwt(savedUser);
    return { accessToken: token, user: savedUser };
  }

  async validateUserWithPassword(identifier: string, password?: string): Promise<User> {
    const normalizedIdentifier = identifier.trim();
    const phone = normalizePhone(normalizedIdentifier);

    // SECURITY: Do not auto-create users - they must be registered first
    if (!this.userRepo) {
      const user = [...this.localUsers.values()].find((candidate) =>
        [candidate.openId, candidate.email, candidate.phone, candidate.name]
          .filter(Boolean)
          .some((value) => value!.toLowerCase() === identifier.trim().toLowerCase()),
      );
      if (!user) throw new UnauthorizedException("User not found. Register an account first.");
      if (user.passwordHash && password && !verifyPassword(password.trim(), user.passwordHash)) {
        throw new UnauthorizedException("Invalid password");
      }
      // SECURITY: Require password if user has one set
      if (user.passwordHash && !password) {
        throw new UnauthorizedException("Password required");
      }
      user.lastSignedIn = new Date();
      return user;
    }

    const user = await this.userRepo.findOne({
      where: [
        { openId: normalizedIdentifier },
        { email: normalizedIdentifier.toLowerCase() },
        { phone },
        { name: normalizedIdentifier },
      ],
      relations: ["hospital"],
    });

    // SECURITY: Do not auto-create users with elevated roles
    if (!user) {
      throw new UnauthorizedException("User not found. Please register first.");
    }

    // SECURITY: Require password verification if user has a password
    if (user.passwordHash) {
      if (!password) {
        throw new UnauthorizedException("Password required");
      }
      const isMatch = verifyPassword(password.trim(), user.passwordHash);
      if (!isMatch) {
        throw new UnauthorizedException("Invalid password");
      }
    }

    user.lastSignedIn = new Date();
    await this.userRepo.save(user);
    return user;
  }

  async login(identifier: string, password?: string): Promise<{ accessToken: string; user: User }> {
    const user = await this.validateUserWithPassword(identifier, password);
    const accessToken = await this.generateJwt(user);
    return { accessToken, user };
  }

  async generateJwt(user: User): Promise<string> {
    const payload = {
      sub: user.id,
      openId: user.openId,
      role: user.role,
      hospitalId: user.hospitalId ?? 1,
      appId: process.env.VITE_APP_ID || "local-app",
      name: user.name || user.openId,
    };
    return this.jwtService.sign(payload);
  }

  async validateTokenPayload(payload: { sub: number; openId: string }): Promise<User> {
    const user = this.userRepo
      ? await this.userRepo.findOne({ where: { id: payload.sub } })
      : [...this.localUsers.values()].find((candidate) => candidate.id === payload.sub) ?? null;
    if (!user) {
      throw new UnauthorizedException("User not found");
    }
    return user;
  }

  async getProfile(userId: number): Promise<User | null> {
    if (!this.userRepo) return [...this.localUsers.values()].find((user) => user.id === userId) ?? null;
    return this.userRepo.findOne({ where: { id: userId } });
  }

  async updateRole(userId: number, role: any): Promise<User> {
    if (!this.userRepo) {
      const user = await this.getProfile(userId);
      if (!user) throw new UnauthorizedException("User not found");
      user.role = role;
      return user;
    }
    await this.userRepo.update(userId, { role });
    return this.userRepo.findOne({ where: { id: userId } }) as Promise<User>;
  }

  async getChatContacts(currentUser: User, facilityId?: number) {
    const targetHospitalId = facilityId || currentUser.hospitalId || 1;
    const contacts = this.userRepo
      ? await this.userRepo.find({
        where: { hospitalId: targetHospitalId },
        order: { name: "ASC" },
      })
      : [...this.localUsers.values()].filter((u) => (u.hospitalId || 1) === targetHospitalId);

    const doctorRoles = ["DOCTOR", "CHIEF_DOCTOR", "doctor", "chief_doc"];
    const staffRoles = ["ASHA_WORKER", "RECEPTIONIST", "asha_worker", "asha", "receptionist"];

    return contacts
      .filter((user) => user.id !== currentUser.id)
      .filter((user) => {
        const role = String(user.role);
        return doctorRoles.includes(role) || staffRoles.includes(role);
      })
      .map((user) => ({
        id: user.id,
        name: user.name || user.openId,
        role: user.role,
      }));
  }

  async createSupabaseChatToken(user: User): Promise<string> {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) {
      throw new UnauthorizedException("Supabase chat is not configured");
    }

    const digest = createHash("sha256").update(`healthcare-chat:${user.id}`).digest("hex");
    const subject = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-${((parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${digest.slice(18, 20)}-${digest.slice(20, 32)}`;
    const role = String(user.role).toLowerCase();

    return new SignJWT({
      role: "authenticated",
      app_user_id: String(user.id),
      app_role: role,
      hospital_id: user.hospitalId ?? 1,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(subject)
      .setAudience("authenticated")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode(secret));
  }

  private createLocalUser(data: { openId: string; name?: string; role?: any; hospitalId?: number; email?: string; phone?: string }, normalizedPhone: string | null, password?: string): User {
    const now = new Date();
    return {
      id: this.nextLocalId++,
      openId: data.openId,
      name: data.name || data.openId,
      email: data.email?.trim().toLowerCase() || null,
      loginMethod: "local",
      phone: normalizedPhone,
      passwordHash: password ? hashPassword(password.trim()) : null,
      role: normalizeRole(data.role),
      hospitalId: data.hospitalId || 1,
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
      hospital: null as never,
      syncOperations: [],
    };
  }
}
