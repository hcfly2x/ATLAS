import { createRequire } from "node:module";

import { expect, test } from "@playwright/test";

import { demandWorkspaceFixture, missionControlFixture } from "../src/test/fixtures.js";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");

test("renders Mission Control read-only against the mocked GET API", async ({ page }) => {
  await page.route("**/dashboard/api/mission-control*", async (route) => {
    expect(route.request().method()).toBe("GET");
    expect(route.request().headers().authorization).toBeUndefined();
    await route.fulfill({
      body: JSON.stringify(missionControlFixture),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/");

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

test("navigates from Mission Control to the read-only demand Workspace", async ({ page }) => {
  await page.route("**/dashboard/api/mission-control*", async (route) => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({
      body: JSON.stringify(missionControlFixture),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/dashboard/api/demand/*", async (route) => {
    expect(route.request().method()).toBe("GET");
    expect(route.request().headers().authorization).toBeUndefined();
    await route.fulfill({
      body: JSON.stringify(demandWorkspaceFixture),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/");
  const progressSection = page.getByRole("region", { name: "Em execução" });
  await progressSection.getByRole("link", { name: "Abrir Workspace" }).click();

  await expect(page).toHaveURL(new RegExp(`/demand/${demandWorkspaceFixture.header.taskId}$`));
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Construir o Workspace read-only da demanda",
    }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Linha do tempo" })).toBeVisible();
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
});

test("creates an expiring session through the credential gate without retaining the credential", async ({
  page,
}) => {
  const credential = "synthetic-browser-owner-credential";
  let authenticated = false;
  await page.route("**/dashboard/auth/session", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ credential });
    authenticated = true;
    await route.fulfill({ status: 204 });
  });
  await page.route("**/dashboard/api/mission-control*", async (route) => {
    if (!authenticated) {
      await route.fulfill({
        body: JSON.stringify({ code: "DASHBOARD_UNAUTHORIZED" }),
        contentType: "application/json",
        status: 401,
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify(missionControlFixture),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/#token=legacy-fragment-secret");
  await page.getByLabel("Credencial do dono").fill(credential);
  await page.getByRole("button", { name: "Abrir Mission Control" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: "Entrega terminal precisa de atenção" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(credential)).toHaveCount(0);

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
});
