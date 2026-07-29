import { missionControlResponseSchema } from "@atlas/contracts";
import { createColumnHelper } from "@tanstack/react-table";

const stackProbeColumn = createColumnHelper<{ readonly label: string }>().accessor("label", {
  id: "label",
});
const contractRejectsEmptyPayload = !missionControlResponseSchema.safeParse({}).success;

export function App() {
  return (
    <main className="shell">
      <section
        aria-labelledby="shell-title"
        className="shell-card"
        data-contract-probe={contractRejectsEmptyPayload ? "ready" : "failed"}
        data-table-probe={stackProbeColumn.id}
      >
        <p className="eyebrow">ATLAS</p>
        <h1 id="shell-title">Dashboard em preparação</h1>
        <p>
          Este shell valida o stack frontend. Mission Control e demais workflows ainda não estão
          conectados nesta fase.
        </p>
        <p className="status">Somente leitura · nenhum dado carregado</p>
      </section>
    </main>
  );
}
