import { expect, test } from "@playwright/test";

test("renders the read-only preparation shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Dashboard em preparação" })).toBeVisible();
  await expect(page.getByText("Somente leitura · nenhum dado carregado")).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("link")).toHaveCount(0);
});
