import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { User } from "../../database/entities/user.entity";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./jwt.strategy";
import { execSync } from "child_process";

function isDatabaseReachable(): boolean {
  if (!process.env.DATABASE_URL) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    execSync(
      `node -e "require('net').createConnection(${parseInt(url.port || "5432", 10)},'${url.hostname}').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"`,
      { timeout: 5000, stdio: "pipe" },
    );
    return true;
  } catch {
    return false;
  }
}

const hasDatabase = isDatabaseReachable();

@Module({
  imports: [
    ...(hasDatabase ? [TypeOrmModule.forFeature([User])] : []),
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? (process.env.NODE_ENV === "production"
        ? (() => { throw new Error("JWT_SECRET environment variable is required in production"); })()
        : "dev-secret-change-in-production"),
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? "7d" as any },
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService, JwtModule],
})
export class AuthModule { }
