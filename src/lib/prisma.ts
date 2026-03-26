import { PrismaClient } from "../../generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

// Prisma dev mode can hot-reload, which may create multiple Prisma instances.
// This singleton pattern prevents connection explosion during development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  (() => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "Missing DATABASE_URL. Add it to your environment (see .env.example)."
      );
    }

    // Prisma v7 requires a driver adapter.
    // For local SQLite files we use libSQL via the Prisma libsql driver adapter.
    const adapter = new PrismaLibSql({ url: databaseUrl });

    return new PrismaClient({
      adapter,
      log: ["error", "warn"],
    });
  })();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

