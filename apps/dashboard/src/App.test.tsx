import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import { App } from "./App.js";

describe("Dashboard shell", () => {
  it("renders the preparation state without actions or accessibility violations", async () => {
    const { container } = render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Dashboard em preparação" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    const audit = await axe.run(container, {
      rules: {
        "color-contrast": { enabled: false },
      },
    });
    expect(audit.violations).toEqual([]);
  });
});
