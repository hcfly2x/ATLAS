import { createRequire } from "node:module";

import { expect, test } from "@playwright/test";

import { missionControlFixture } from "../src/test/fixtures.js";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
const token = "synthetic-browser-dashboard-token";

test("renders Mission Control read-only against the mocked GET API", async ({ page }) => {
  await page.route("**/dashboard/api/mission-control*", async (route) => {
    expect(route.request().method()).toBe("GET");
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    await route.fulfill({
      body: JSON.stringify(missionControlFixture),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto(`/#token=${token}`);

  await expect(
    page.getByRole("heading", { level: 1, name: "Entrega terminal precisa de atenção" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Precisa de mim" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Riscos & Proatividade" })).toBeVisible();
  await expect(page.getByRole("button", { name: /aprovar|cancelar|pausar|editar/i })).toHaveCount(
    0,
  );

  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => {
    const axe = (
      globalThis as unknown as {
        axe: {
          run: () => Promise<{
            violations: readonly {
              id: string;
              nodes: readonly { target: readonly string[] }[];
            }[];
          }>;
        };
      }
    ).axe;
    return (await axe.run()).violations.map(({ id, nodes }) => ({ id, nodes }));
  });
  expect(violations).toEqual([]);

  await page.setViewportSize({ height: 844, width: 390 });
  await expect(page.getByRole("heading", { name: "Riscos & Proatividade" })).toBeVisible();
});
