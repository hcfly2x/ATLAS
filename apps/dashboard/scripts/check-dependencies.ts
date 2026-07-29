import { readFile } from "node:fs/promises";
import { URL } from "node:url";

import { z } from "zod";

const manifestSchema = z
  .object({
    dependencies: z.record(z.string()),
    devDependencies: z.record(z.string()),
  })
  .passthrough();
const manifest = manifestSchema.parse(
  JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as unknown,
);
const approved = {
  dependencies: [
    "@atlas/contracts",
    "@tanstack/react-query",
    "@tanstack/react-table",
    "react",
    "react-dom",
    "react-router-dom",
    "zod",
  ],
  devDependencies: [
    "@playwright/test",
    "@tailwindcss/vite",
    "@testing-library/jest-dom",
    "@testing-library/react",
    "@types/react",
    "@types/react-dom",
    "@vitejs/plugin-react",
    "axe-core",
    "jsdom",
    "react-doctor",
    "shadcn",
    "tailwindcss",
    "typescript",
    "vite",
    "vitest",
  ],
} as const;

for (const group of ["dependencies", "devDependencies"] as const) {
  const actual = Object.keys(manifest[group]).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...approved[group]].sort())) {
    throw new Error(`${group} differs from the approved Dashboard dependency list`);
  }
}
