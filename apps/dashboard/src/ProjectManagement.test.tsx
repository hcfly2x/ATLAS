import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ProjectManagement } from "./ProjectManagement.js";

function renderManagement() {
  const client = () =>
    Promise.resolve({
      projects: [
        {
          activationIssues: ["Informe o caminho absoluto do repositório."],
          activationReady: false,
          allowedExecutables: [],
          autonomyLevel: 2,
          configHash: `sha256:${"a".repeat(64)}`,
          id: "safe-project",
          name: "Safe Project",
          repositoryConfigured: false,
          retention: {
            audit_events_expire: false as const,
            files_days: 30,
            logs_days: 30,
            sensitive_days: 7,
          },
          status: "draft" as const,
        },
      ],
    });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProjectManagement client={client} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Project management", () => {
  it("shows safe draft defaults, activation blockers and no local repository value", async () => {
    const { container } = renderManagement();

    expect(await screen.findByRole("heading", { level: 1, name: "Gerenciar" })).toBeInTheDocument();
    expect(screen.getByText("Rascunho · safe-project")).toBeInTheDocument();
    expect(screen.getByText("Informe o caminho absoluto do repositório.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ativar projeto" })).toBeDisabled();
    expect(container.textContent).not.toContain("/Users/SECRET_REPOSITORY");
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
