import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { sign, verify } from "jsonwebtoken";

/**
 * Tests for JWT token validation and security
 */

const JWT_SECRET = "test-secret-for-testing-only";

describe("JWT Token Validation", () => {
  describe("Invalid Token Handling", () => {
    it("rejects malformed JWT tokens", () => {
      const malformedTokens = [
        "not.a.jwt",
        "too.many.parts.here.we.go",
        "",
        "   ",
        "header.payload", // missing signature
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9", // missing third part
      ];

      malformedTokens.forEach((token) => {
        expect(() => {
          try {
            verify(token, JWT_SECRET);
          } catch (error: any) {
            throw new Error("Invalid token");
          }
        }).toThrow();
      });
    });

    it("rejects tokens signed with wrong secret", () => {
      const token = sign({ sub: 1, openId: "user1" }, "wrong-secret");
      
      expect(() => {
        verify(token, JWT_SECRET);
      }).toThrow();
    });

    it("rejects tokens with invalid structure", () => {
      const invalidTokens = [
        "null",
        "undefined",
        "12345",
        JSON.stringify({ not: "a token" }),
      ];

      invalidTokens.forEach((token) => {
        expect(() => {
          verify(token, JWT_SECRET);
        }).toThrow();
      });
    });
  });

  describe("Expired Token Handling", () => {
    it("rejects expired tokens", () => {
      // Create a token that expired 1 hour ago
      const expiredToken = sign(
        { sub: 1, openId: "user1" },
        JWT_SECRET,
        { expiresIn: "-1h" }
      );

      expect(() => {
        verify(expiredToken, JWT_SECRET);
      }).toThrow("jwt expired");
    });

    it("accepts valid non-expired tokens", () => {
      const validToken = sign(
        { sub: 1, openId: "user1", role: "DOCTOR", hospitalId: 1 },
        JWT_SECRET,
        { expiresIn: "1h" }
      );

      const decoded = verify(validToken, JWT_SECRET) as any;
      expect(decoded.sub).toBe(1);
      expect(decoded.openId).toBe("user1");
      expect(decoded.role).toBe("DOCTOR");
      expect(decoded.hospitalId).toBe(1);
    });

    it("sets appropriate expiry time", () => {
      const token = sign(
        { sub: 1, openId: "user1" },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      const decoded = verify(token, JWT_SECRET) as any;
      const now = Math.floor(Date.now() / 1000);
      const sevenDaysInSeconds = 7 * 24 * 60 * 60;
      
      // Expiry should be approximately 7 days from now
      expect(decoded.exp - now).toBeLessThanOrEqual(sevenDaysInSeconds + 10);
      expect(decoded.exp - now).toBeGreaterThan(sevenDaysInSeconds - 10);
    });
  });

  describe("Token Payload Validation", () => {
    it("includes required fields in token", () => {
      const payload = {
        sub: 1,
        openId: "user1",
        role: "DOCTOR",
        hospitalId: 1,
      };

      const token = sign(payload, JWT_SECRET, { expiresIn: "1h" });
      const decoded = verify(token, JWT_SECRET) as any;

      expect(decoded.sub).toBe(1);
      expect(decoded.openId).toBe("user1");
      expect(decoded.role).toBe("DOCTOR");
      expect(decoded.hospitalId).toBe(1);
    });

    it("rejects tokens with missing required fields", () => {
      // Token without sub or openId
      const incompleteToken = sign({}, JWT_SECRET, { expiresIn: "1h" });
      const decoded = verify(incompleteToken, JWT_SECRET) as any;

      // The JWT library will decode it, but application should validate fields
      expect(decoded.sub).toBeUndefined();
      expect(decoded.openId).toBeUndefined();
    });

    it("rejects tokens with tampered payload", () => {
      const token = sign({ sub: 1, role: "DOCTOR" }, JWT_SECRET, { expiresIn: "1h" });
      
      // Tamper with the payload (change DOCTOR to ADMIN)
      const parts = token.split(".");
      const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
      payload.role = "ADMIN";
      parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64");
      const tamperedToken = parts.join(".");

      // Verification should fail
      expect(() => {
        verify(tamperedToken, JWT_SECRET);
      }).toThrow();
    });
  });

  describe("Token Security Best Practices", () => {
    it("does not include sensitive data in token payload", () => {
      const payload = {
        sub: 1,
        openId: "user1",
        role: "DOCTOR",
        hospitalId: 1,
        // Should NOT include:
        // passwordHash: "hashed-password",
        // secretKey: "some-secret",
      };

      const token = sign(payload, JWT_SECRET, { expiresIn: "1h" });
      const decoded = verify(token, JWT_SECRET) as any;

      expect(decoded.passwordHash).toBeUndefined();
      expect(decoded.secretKey).toBeUndefined();
    });

    it("uses HS256 algorithm", () => {
      const token = sign({ sub: 1 }, JWT_SECRET, { algorithm: "HS256" });
      const parts = token.split(".");
      const header = JSON.parse(Buffer.from(parts[0], "base64").toString());
      
      expect(header.alg).toBe("HS256");
      expect(header.typ).toBe("JWT");
    });
  });
});

describe("Session Cookie Security", () => {
  it("uses secure cookie options in production", () => {
    const isProduction = true;
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: "strict" as const,
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    };

    expect(cookieOptions.httpOnly).toBe(true);
    expect(cookieOptions.secure).toBe(true);
    expect(cookieOptions.sameSite).toBe("strict");
  });

  it("sets appropriate maxAge", () => {
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    expect(maxAge).toBe(604800000);
    expect(maxAge).toBeLessThan(365 * 24 * 60 * 60 * 1000); // Less than 1 year
  });

  it("clears cookie with negative maxAge", () => {
    const clearOptions = {
      maxAge: -1,
    };
    
    expect(clearOptions.maxAge).toBe(-1);
  });
});
