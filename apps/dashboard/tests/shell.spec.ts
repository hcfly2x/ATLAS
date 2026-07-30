import { createRequire } from "node:module";

import { expect, test } from "@playwright/test";

import { demandWorkspaceFixture, missionControlFixture } from "../src/test/fixtures.js";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");

test("renders Mission Control with governed demand creation", async ({ page }) => {
  let createRequestObserved = false;
  await page.route("**/dashboard/api/projects", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ projects: [{ id: "atlas", name: "ATLAS" }] }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/dashboard/api/mission-control*", async (route) => {
    expect(route.request().method()).toBe("GET");
    expect(route.request().headers().authorization).toBeUndefined();
    await route.fulfill({
      body: JSON.stringify(missionControlFixture),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/dashboard/auth/session", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        csrfToken: "a".repeat(43),
        expiresAt: "2026-07-29T13:00:00.000Z",
        role: "owner",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/dashboard/api/demands", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-atlas-csrf-token"]).toBe("a".repeat(43));
    expect(route.request().postDataJSON()).toMatchObject({
      objective: "Criar demanda pelo navegador",
      projectId: "atlas",
    });
    createRequestObserved = true;
    await route.fulfill({
      body: JSON.stringify({
        idempotentReplay: false,
        task: {
          id: demandWorkspaceFixture.header.taskId,
          projectId: "atlas",
          state: "NEW",
          version: 0,
        },
      }),
      contentType: "application/json",
      status: 201,
    });
  });
  await page.route("**/dashboard/api/demand/*", async (route) => {
    await route.fulfill({
      body: JSON.stringify(demandWorkspaceFixture),
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
  await expect(page.getByRole("button", { name: "Criar demanda" })).toBeVisible();
  await expect(page.getByRole("button", { name: /cancelar|pausar|editar/i })).toHaveCount(0);
  await page.getByLabel("Projeto").selectOption("atlas");
  await page.getByLabel("Objetivo").fill("Criar demanda pelo navegador");
  await page.getByRole("button", { name: "Criar demanda" }).click();
  await expect(page).toHaveURL(new RegExp(`/demand/${demandWorkspaceFixture.header.taskId}$`));
  expect(createRequestObserved).toBe(true);

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
  await expect(page.getByRole("heading", { name: "Cancelamento" })).toBeVisible();
});

test("navigates to the Workspace and confirms cooperative cancellation", async ({ page }) => {
  await page.route("**/dashboard/api/projects", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ projects: [{ id: "atlas", name: "ATLAS" }] }),
      contentType: "application/json",
      status: 200,
    });
  });
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
  await page.route("**/dashboard/auth/session", async (route) => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({
      body: JSON.stringify({
        csrfToken: "a".repeat(43),
        expiresAt: "2026-07-29T13:00:00.000Z",
        role: "owner",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/dashboard/api/tasks/*/cancel", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-atlas-csrf-token"]).toBe("a".repeat(43));
    expect(route.request().postDataJSON()).toMatchObject({
      taskVersion: demandWorkspaceFixture.header.taskVersion,
    });
    await route.fulfill({
      body: JSON.stringify({
        idempotentReplay: false,
        mode: "cooperative",
        task: {
          id: demandWorkspaceFixture.header.taskId,
          projectId: "atlas",
          state: "CANCEL_REQUESTED",
          version: demandWorkspaceFixture.header.taskVersion + 1,
        },
      }),
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
  await expect(page.getByRole("button", { name: "Cancelar demanda" })).toBeVisible();
  await expect(page.getByRole("button", { name: /pausar|editar/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Cancelar demanda" }).click();
  const cancelDialog = page.getByRole("dialog");
  await expect(cancelDialog.getByText("cooperativo", { exact: true })).toBeVisible();
  await expect(cancelDialog.getByText(demandWorkspaceFixture.header.taskId)).toBeVisible();
  await expect(
    cancelDialog.getByText(
      `${demandWorkspaceFixture.header.project.name} (${demandWorkspaceFixture.header.project.id})`,
    ),
  ).toBeVisible();
  await expect(cancelDialog.getByText(demandWorkspaceFixture.header.taskState)).toBeVisible();
  await page.getByRole("button", { name: "Confirmar cancelamento" }).click();

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
  await page.route("**/dashboard/api/projects", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ projects: [{ id: "atlas", name: "ATLAS" }] }),
      contentType: "application/json",
      status: 200,
    });
  });
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
