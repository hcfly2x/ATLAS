import { createCoordinatorApp } from "./app.js";

const app = createCoordinatorApp();
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "127.0.0.1";

try {
  await app.listen({ host, port });
} catch (error: unknown) {
  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      message: "coordinator failed to start",
      error: error instanceof Error ? error.message : "unknown error",
    })}\n`,
  );
  process.exitCode = 1;
}
