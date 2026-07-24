import { getWorkerFoundationStatus } from "./index.js";

process.stdout.write(`${JSON.stringify(getWorkerFoundationStatus("worker-startup"))}\n`);
