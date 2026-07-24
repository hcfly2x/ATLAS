import { fileURLToPath } from "node:url";

import { createSetupApp } from "./setup/app.js";
import { ProjectConfigStore } from "./setup/project-config.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "127.0.0.1";
if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
  throw new Error("Pilot Setup Wizard requires HOST=127.0.0.1");
}

const projectConfigStore = new ProjectConfigStore(
  process.env.ATLAS_PROJECTS_PATH ??
    fileURLToPath(new URL("../../../.atlas/projects.yaml", import.meta.url)),
);
const app = createSetupApp(projectConfigStore);

try {
  await app.listen({ host, port });
} catch (error: unknown) {
  app.log.error({ error }, "Pilot Setup Wizard failed to start");
  process.exitCode = 1;
  await app.close();
}
