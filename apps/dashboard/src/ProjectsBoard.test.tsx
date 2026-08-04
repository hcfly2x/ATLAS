import type { ProjectsBoardResponse } from "@atlas/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { App } from "./App.js";
import { ProjectsBoard } from "./ProjectsBoard.js";
import { ProjectsBoardReadError, type ProjectsBoardClient } from "./projects-board.js";
import { projectsBoardFixture } from "./test/fixtures.js";

function renderRoute(client: ProjectsBoardClient) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/projetos"]}>
        <App projectsBoardClient={client} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Projects board UI", () => {
  it("groups demands into four simple workflow columns", async () => {
    renderRoute(() => Promise.resolve(projectsBoardFixture));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Projetos e demandas" }),
    ).toBeInTheDocument();
    for (const heading of ["Precisa de você", "Em execução", "Parado", "Concluído"]) {
      expect(screen.getAllByRole("heading", { name: heading })).toHaveLength(2);
    }
    expect(screen.getByText("Revisar a entrega do dashboard")).toBeInTheDocument();
    expect(screen.getByText("Construir o quadro de projetos")).toBeInTheDocument();
    expect(screen.getByText("Retomar a integração externa")).toBeInTheDocument();
    expect(screen.getByText("Publicar a autenticação")).toBeInTheDocument();
    expect(screen.getAllByText("Abrir Workspace →")).toHaveLength(4);
  });

  it("keeps projects without active demands collapsed", async () => {
    const { container } = renderRoute(() => Promise.resolve(projectsBoardFixture));
    await screen.findByText("Projeto futuro");

    const lanes = container.querySelectorAll("details.project-lane");
    expect(lanes).toHaveLength(2);
    expect(lanes[0]).toHaveAttribute("open");
    expect(lanes[1]).not.toHaveAttribute("open");
    expect(screen.getByText("Sem demanda ativa")).toBeInTheDocument();
    expect(screen.getByText("sem descrição")).toBeInTheDocument();
    expect(screen.getByText("Projeto ativo")).toBeInTheDocument();
    expect(screen.getByText("Projeto em rascunho")).toBeInTheDocument();
    expect(screen.getByText(/Ative no setup local em \/setup/)).toBeInTheDocument();
  });

  it("keeps an inactive project collapsed even if historical data reports active work", () => {
    const activeProject = projectsBoardFixture.projects[0];
    if (activeProject === undefined) throw new Error("fixture must contain an active project");
    const inactiveWithWork = {
      ...projectsBoardFixture,
      projects: [
        {
          ...activeProject,
          id: "inactive",
          isActive: false,
          name: "Projeto inativo",
        },
      ],
    };
    const { container } = render(
      <MemoryRouter>
        <ProjectsBoard data={inactiveWithWork} />
      </MemoryRouter>,
    );

    expect(container.querySelector("details.project-lane")).not.toHaveAttribute("open");
  });

  it("renders loading, empty and fail-open error states", async () => {
    const pending = renderRoute(() => new Promise<ProjectsBoardResponse>(() => undefined));
    expect(screen.getByText("Organizando as demandas por situação…")).toBeInTheDocument();
    pending.unmount();

    const empty = renderRoute(() => Promise.resolve({ ...projectsBoardFixture, projects: [] }));
    expect(await screen.findByText("Nenhum projeto disponível")).toBeInTheDocument();
    empty.unmount();

    renderRoute(() => Promise.reject(new ProjectsBoardReadError("request_failed")));
    expect(await screen.findByText("Projetos estão indeterminados")).toBeInTheDocument();
    expect(screen.getByText(/Nenhuma situação ou contagem foi inferida/u)).toBeInTheDocument();
  });

  it("requests a new session when authorization is absent", async () => {
    renderRoute(() => Promise.reject(new ProjectsBoardReadError("unauthorized")));

    expect(await screen.findByLabelText("Credencial do dono")).toBeInTheDocument();
    expect(screen.getByText("Sessão ausente ou expirada.")).toBeInTheDocument();
  });

  it("does not render undeclared sensitive fields and passes axe with contrast enabled", async () => {
    const tainted = {
      ...projectsBoardFixture,
      messageText: "SECRET_MESSAGE_TEXT",
      projects: projectsBoardFixture.projects.map((project) => ({
        ...project,
        payload: "SECRET_PAYLOAD",
        prompt: "SECRET_PROMPT",
      })),
    } as ProjectsBoardResponse;
    const { container } = render(
      <MemoryRouter>
        <ProjectsBoard data={tainted} />
      </MemoryRouter>,
    );

    expect(container.textContent).not.toContain("SECRET_");
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
