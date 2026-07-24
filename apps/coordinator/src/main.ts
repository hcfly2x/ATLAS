import { PrismaClient } from "@prisma/client";

import { createCoordinatorApp } from "./app.js";
import { PrismaTaskCoreStore } from "./core/prisma-task-core-store.js";

const prisma = new PrismaClient();
const app = createCoordinatorApp({
  logger: true,
  taskStore: new PrismaTaskCoreStore(prisma),
});
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "127.0.0.1";

app.addHook("onClose", async () => prisma.$disconnect());

try {
  await app.listen({ host, port });
} catch (error: unknown) {
  app.log.error({ error }, "coordinator failed to start");
  process.exitCode = 1;
  await app.close();
}
