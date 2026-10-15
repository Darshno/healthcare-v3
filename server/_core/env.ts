export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? (process.env.NODE_ENV === "production" 
    ? (() => { throw new Error("JWT_SECRET environment variable is required in production"); })()
    : "dev-secret-change-in-production"),
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  dbSsl: process.env.DB_SSL === "true",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
};
