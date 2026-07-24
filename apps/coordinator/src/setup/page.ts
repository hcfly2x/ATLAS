export const setupPage = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>ATLAS · Configuração do piloto</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #090d0c;
        --panel: #111715;
        --panel-2: #171f1c;
        --line: #29342f;
        --text: #f2f6f3;
        --muted: #95a49c;
        --accent: #b7f26c;
        --accent-ink: #17200e;
        --warning: #f5c86a;
        --danger: #ff8e84;
        --radius: 18px;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at 85% 0%, rgba(183, 242, 108, .09), transparent 28rem),
          linear-gradient(145deg, #080b0a, var(--bg));
        color: var(--text);
        font: 15px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      button, input, select { font: inherit; }
      button { cursor: pointer; }
      .shell { width: min(1440px, 100%); margin: 0 auto; padding: 28px; }
      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 28px;
      }
      .brand { display: flex; align-items: center; gap: 14px; }
      .mark {
        display: grid;
        place-items: center;
        width: 42px;
        height: 42px;
        border: 1px solid #41533f;
        border-radius: 13px;
        background: linear-gradient(145deg, #202b22, #111711);
        color: var(--accent);
        font-weight: 800;
        letter-spacing: -.04em;
      }
      h1 { margin: 0; font-size: 18px; letter-spacing: -.02em; }
      .eyebrow {
        margin: 0 0 2px;
        color: var(--muted);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .14em;
        text-transform: uppercase;
      }
      .local-badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 9px 12px;
        border: 1px solid var(--line);
        border-radius: 999px;
        color: var(--muted);
        background: rgba(17, 23, 21, .7);
        font-size: 13px;
      }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 18px var(--accent); }
      .layout { display: grid; grid-template-columns: 310px minmax(0, 1fr); gap: 20px; }
      .sidebar, .workspace {
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: rgba(17, 23, 21, .9);
        box-shadow: 0 24px 80px rgba(0, 0, 0, .22);
      }
      .sidebar { padding: 18px; align-self: start; position: sticky; top: 18px; }
      .sidebar-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
      .sidebar h2 { margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); }
      .icon-button {
        width: 34px;
        height: 34px;
        border: 1px solid var(--line);
        border-radius: 10px;
        color: var(--text);
        background: var(--panel-2);
        font-size: 20px;
      }
      .project-list { display: grid; gap: 8px; }
      .project-item {
        width: 100%;
        padding: 13px;
        border: 1px solid transparent;
        border-radius: 13px;
        color: var(--text);
        background: transparent;
        text-align: left;
      }
      .project-item:hover { background: var(--panel-2); }
      .project-item.active { border-color: #495d45; background: #1a241c; }
      .project-name { display: block; font-weight: 700; }
      .project-meta { display: flex; gap: 8px; align-items: center; margin-top: 5px; color: var(--muted); font-size: 12px; }
      .status-pill {
        padding: 2px 7px;
        border-radius: 999px;
        background: #273128;
        text-transform: uppercase;
        font-size: 9px;
        font-weight: 800;
        letter-spacing: .08em;
      }
      .workspace { overflow: hidden; }
      .hero {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        padding: 28px 30px 24px;
        border-bottom: 1px solid var(--line);
        background: linear-gradient(110deg, rgba(183, 242, 108, .06), transparent 44%);
      }
      .hero h2 { margin: 4px 0 6px; font-size: clamp(24px, 4vw, 34px); letter-spacing: -.04em; }
      .hero p { margin: 0; color: var(--muted); max-width: 680px; }
      .readiness {
        min-width: 170px;
        padding: 14px;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: rgba(9, 13, 12, .45);
        align-self: center;
      }
      .readiness strong { display: block; font-size: 22px; }
      .readiness span { color: var(--muted); font-size: 12px; }
      form { padding: 28px 30px 32px; }
      .section { margin-bottom: 32px; }
      .section-title { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
      .section-number {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 9px;
        background: var(--panel-2);
        color: var(--accent);
        font-weight: 800;
        font-size: 12px;
      }
      .section h3 { margin: 0; font-size: 16px; }
      .grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; }
      .field { grid-column: span 6; }
      .field.third { grid-column: span 4; }
      .field.full { grid-column: 1 / -1; }
      label { display: block; margin: 0 0 7px; color: #cbd5cf; font-size: 12px; font-weight: 700; }
      input, select {
        width: 100%;
        min-height: 44px;
        padding: 10px 12px;
        border: 1px solid var(--line);
        border-radius: 11px;
        outline: none;
        color: var(--text);
        background: #0d1210;
      }
      input:focus, select:focus { border-color: #6d8a61; box-shadow: 0 0 0 3px rgba(183, 242, 108, .07); }
      input[readonly] { color: var(--muted); }
      .hint { margin: 6px 0 0; color: var(--muted); font-size: 11px; }
      .command-list { display: grid; gap: 10px; }
      .command-row { display: grid; grid-template-columns: minmax(150px, .7fr) minmax(220px, 1.3fr) 38px; gap: 8px; }
      .remove-command {
        border: 1px solid var(--line);
        border-radius: 10px;
        color: var(--muted);
        background: #0d1210;
      }
      .secondary {
        margin-top: 10px;
        padding: 9px 12px;
        border: 1px solid var(--line);
        border-radius: 10px;
        color: var(--text);
        background: var(--panel-2);
      }
      .validation {
        display: none;
        margin: 0 30px 28px;
        padding: 16px 18px;
        border: 1px solid var(--line);
        border-radius: 13px;
        background: #0d1210;
      }
      .validation.show { display: block; }
      .validation.valid { border-color: #49653b; }
      .validation.invalid { border-color: #755945; }
      .validation h3 { margin: 0 0 7px; font-size: 14px; }
      .validation ul { margin: 7px 0 0; padding-left: 18px; color: var(--warning); }
      .actions {
        position: sticky;
        bottom: 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 18px 30px;
        border-top: 1px solid var(--line);
        background: rgba(14, 20, 17, .96);
        backdrop-filter: blur(14px);
      }
      .action-group { display: flex; gap: 10px; }
      .validate-button, .save-button {
        min-height: 42px;
        padding: 0 18px;
        border-radius: 11px;
        font-weight: 800;
      }
      .validate-button { border: 1px solid var(--line); color: var(--text); background: var(--panel-2); }
      .save-button { border: 0; color: var(--accent-ink); background: var(--accent); }
      .save-button:disabled { opacity: .5; cursor: wait; }
      .save-note { color: var(--muted); font-size: 12px; }
      .toast {
        position: fixed;
        right: 24px;
        bottom: 24px;
        max-width: 420px;
        padding: 14px 16px;
        border: 1px solid var(--line);
        border-radius: 13px;
        background: #17201b;
        box-shadow: 0 20px 60px rgba(0, 0, 0, .4);
        transform: translateY(20px);
        opacity: 0;
        pointer-events: none;
        transition: .2s ease;
      }
      .toast.show { transform: translateY(0); opacity: 1; }
      .toast.error { border-color: #754b48; color: #ffd1cd; }
      @media (max-width: 900px) {
        .shell { padding: 16px; }
        .layout { grid-template-columns: 1fr; }
        .sidebar { position: static; }
        .project-list { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
        .hero { flex-direction: column; }
        .readiness { width: 100%; }
      }
      @media (max-width: 640px) {
        .topbar { align-items: flex-start; }
        .local-badge { display: none; }
        .hero, form, .actions { padding-left: 18px; padding-right: 18px; }
        .validation { margin-left: 18px; margin-right: 18px; }
        .field, .field.third { grid-column: 1 / -1; }
        .command-row { grid-template-columns: 1fr 38px; }
        .command-row .command-args { grid-column: 1 / -1; grid-row: 2; }
        .actions { align-items: flex-start; flex-direction: column; }
        .action-group { width: 100%; }
        .action-group button { flex: 1; }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="mark">A</div>
          <div>
            <p class="eyebrow">Pilot setup</p>
            <h1>ATLAS</h1>
          </div>
        </div>
        <div class="local-badge"><span class="dot"></span> Configuração local protegida</div>
      </header>
      <div class="layout">
        <aside class="sidebar">
          <div class="sidebar-head">
            <h2>Projetos</h2>
            <button class="icon-button" id="new-project" type="button" aria-label="Novo projeto">+</button>
          </div>
          <div class="project-list" id="project-list" aria-live="polite"></div>
        </aside>
        <section class="workspace">
          <div class="hero">
            <div>
              <p class="eyebrow">Configuração executável</p>
              <h2 id="project-title">Carregando projetos…</h2>
              <p>Prepare um projeto para o piloto sem editar YAML manualmente. Nada é enviado para a nuvem.</p>
            </div>
            <div class="readiness">
              <strong id="readiness-value">—</strong>
              <span id="readiness-label">Aguardando validação</span>
            </div>
          </div>
          <div class="validation" id="validation-box" role="status"></div>
          <form id="project-form">
            <section class="section">
              <div class="section-title"><span class="section-number">01</span><h3>Identidade e política</h3></div>
              <div class="grid">
                <div class="field third"><label for="id">ID</label><input id="id" required /></div>
                <div class="field"><label for="name">Nome</label><input id="name" required /></div>
                <div class="field third">
                  <label for="status">Status</label>
                  <select id="status"><option value="draft">Draft</option><option value="active">Active</option><option value="future">Future</option><option value="archived">Archived</option></select>
                </div>
                <div class="field third">
                  <label for="risk">Risco</label>
                  <select id="risk"><option value="low">Baixo</option><option value="moderate">Moderado</option><option value="high">Alto</option><option value="critical">Crítico</option></select>
                </div>
                <div class="field third"><label for="classification">Classificação</label><input id="classification" required /></div>
                <div class="field third"><label for="autonomy">Autonomia</label><select id="autonomy"><option value="0">0 · Observação</option><option value="1">1 · Recomendação</option><option value="2">2 · Limitada</option><option value="3">3 · Supervisionada</option><option value="4" disabled>4 · Reservada</option></select></div>
                <div class="field"><label for="policy">Política</label><input id="policy" required /></div>
                <div class="field"><label for="protected-profile">Perfil de paths protegidos</label><input id="protected-profile" required /></div>
              </div>
            </section>
            <section class="section">
              <div class="section-title"><span class="section-number">02</span><h3>Repositório e ferramentas</h3></div>
              <div class="grid">
                <div class="field full">
                  <label for="repository">Caminho absoluto do repositório</label>
                  <input id="repository" placeholder="/Users/seu-usuario/Projetos/meu-projeto" />
                  <p class="hint">O diretório precisa existir neste Mac e conter metadados Git.</p>
                </div>
                <div class="field third"><label for="node-version">Node mínimo</label><input id="node-version" placeholder=">=22.13.0" /></div>
                <div class="field third"><label for="git-version">Git mínimo</label><input id="git-version" placeholder=">=2.39.0" /></div>
                <div class="field third"><label for="codex-version">Codex CLI mínimo</label><input id="codex-version" placeholder=">=1.0.0" /></div>
                <div class="field full"><label for="gnu-tools">Ferramentas GNU declaradas</label><input id="gnu-tools" placeholder="gsed, ggrep (opcional)" /><p class="hint">Separe por vírgulas. Deixe vazio quando o projeto usa ferramentas BSD/macOS.</p></div>
              </div>
            </section>
            <section class="section">
              <div class="section-title"><span class="section-number">03</span><h3>Comandos permitidos</h3></div>
              <div class="command-list" id="command-list"></div>
              <button class="secondary" id="add-command" type="button">+ Adicionar comando</button>
              <p class="hint">Cada linha é executada sem shell. Exemplo: executável <strong>pnpm</strong>, argumentos <strong>test</strong>.</p>
            </section>
            <section class="section">
              <div class="section-title"><span class="section-number">04</span><h3>Limites e retenção</h3></div>
              <div class="grid">
                <div class="field third"><label for="task-cost">Teto por tarefa (US$)</label><input id="task-cost" type="number" min="0" step="0.01" /></div>
                <div class="field third"><label for="logs-days">Logs (dias)</label><input id="logs-days" type="number" min="1" /></div>
                <div class="field third"><label for="files-days">Arquivos (dias)</label><input id="files-days" type="number" min="1" /></div>
                <div class="field third"><label for="sensitive-days">Dados sensíveis (dias)</label><input id="sensitive-days" type="number" min="1" placeholder="Não aplicável" /></div>
              </div>
            </section>
          </form>
          <footer class="actions">
            <span class="save-note">Salvar altera apenas <code>.atlas/projects.yaml</code>.</span>
            <div class="action-group">
              <button class="validate-button" id="validate" type="button">Validar ativação</button>
              <button class="save-button" id="save" type="button">Salvar projeto</button>
            </div>
          </footer>
        </section>
      </div>
    </main>
    <div class="toast" id="toast" role="alert"></div>
    <script>
      const state = { projects: [], selectedId: null, creating: false };
      const byId = (id) => document.getElementById(id);
      const fields = {
        id: byId("id"), name: byId("name"), status: byId("status"), risk: byId("risk"),
        classification: byId("classification"), autonomy: byId("autonomy"), policy: byId("policy"),
        protectedProfile: byId("protected-profile"), repository: byId("repository"),
        nodeVersion: byId("node-version"), gitVersion: byId("git-version"),
        codexVersion: byId("codex-version"), gnuTools: byId("gnu-tools"),
        taskCost: byId("task-cost"), logsDays: byId("logs-days"), filesDays: byId("files-days"),
        sensitiveDays: byId("sensitive-days")
      };
      function toast(message, error = false) {
        const element = byId("toast");
        element.textContent = message;
        element.className = "toast show" + (error ? " error" : "");
        window.setTimeout(() => { element.className = "toast"; }, 3200);
      }
      function commandRow(command = { executable: "", args: [] }) {
        const row = document.createElement("div");
        row.className = "command-row";
        const executable = document.createElement("input");
        executable.className = "command-executable";
        executable.placeholder = "pnpm";
        executable.value = command.executable;
        executable.setAttribute("aria-label", "Executável");
        const args = document.createElement("input");
        args.className = "command-args";
        args.placeholder = "test";
        args.value = command.args.join(" ");
        args.setAttribute("aria-label", "Argumentos separados por espaço");
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "remove-command";
        remove.textContent = "×";
        remove.setAttribute("aria-label", "Remover comando");
        remove.addEventListener("click", () => row.remove());
        row.append(executable, args, remove);
        byId("command-list").append(row);
      }
      function renderList() {
        const list = byId("project-list");
        list.replaceChildren();
        for (const project of state.projects) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "project-item" + (project.id === state.selectedId ? " active" : "");
          const name = document.createElement("span");
          name.className = "project-name";
          name.textContent = project.name;
          const meta = document.createElement("span");
          meta.className = "project-meta";
          const status = document.createElement("span");
          status.className = "status-pill";
          status.textContent = project.status;
          const risk = document.createElement("span");
          risk.textContent = project.risk;
          meta.append(status, risk);
          button.append(name, meta);
          button.addEventListener("click", () => selectProject(project.id));
          list.append(button);
        }
      }
      function fill(project, creating = false) {
        state.creating = creating;
        fields.id.readOnly = !creating;
        fields.id.value = project.id;
        fields.name.value = project.name;
        fields.status.value = project.status;
        fields.risk.value = project.risk;
        fields.classification.value = project.data_classification;
        fields.autonomy.value = String(project.autonomy_level);
        fields.policy.value = project.policy;
        fields.protectedProfile.value = project.protected_paths_profile;
        fields.repository.value = project.repository ?? "";
        fields.nodeVersion.value = project.required_tools.node ?? "";
        fields.gitVersion.value = project.required_tools.git ?? "";
        fields.codexVersion.value = project.required_tools.codex_cli ?? "";
        fields.gnuTools.value = project.required_tools.gnu_tools.join(", ");
        fields.taskCost.value = project.task_cost_limit_usd ?? "";
        fields.logsDays.value = String(project.retention.logs_days);
        fields.filesDays.value = String(project.retention.files_days);
        fields.sensitiveDays.value = project.retention.sensitive_days ?? "";
        byId("command-list").replaceChildren();
        project.allowed_commands.forEach(commandRow);
        byId("project-title").textContent = creating ? "Novo projeto" : project.name;
        hideValidation();
      }
      function selectProject(id) {
        const project = state.projects.find((candidate) => candidate.id === id);
        if (!project) return;
        state.selectedId = id;
        fill(project);
        renderList();
      }
      function draftProject() {
        return {
          id: "", name: "", status: "draft", risk: "moderate",
          data_classification: "internal", policy: "least_privilege", autonomy_level: 2,
          repository: null, protected_paths_profile: "project_default", allowed_commands: [],
          required_tools: { node: ">=22.13.0", git: ">=2.39.0", codex_cli: ">=1.0.0", gnu_tools: [] },
          task_cost_limit_usd: 5,
          retention: { logs_days: 30, files_days: 30, sensitive_days: null, audit_events_expire: false }
        };
      }
      function value() {
        const commands = [...document.querySelectorAll(".command-row")]
          .map((row) => ({
            executable: row.querySelector(".command-executable").value.trim(),
            args: row.querySelector(".command-args").value.trim().split(/\\s+/).filter(Boolean)
          }))
          .filter((command) => command.executable.length > 0);
        return {
          id: fields.id.value.trim(), name: fields.name.value.trim(), status: fields.status.value,
          risk: fields.risk.value, data_classification: fields.classification.value.trim(),
          policy: fields.policy.value.trim(), autonomy_level: Number(fields.autonomy.value),
          repository: fields.repository.value.trim() || null,
          protected_paths_profile: fields.protectedProfile.value.trim(),
          allowed_commands: commands,
          required_tools: {
            node: fields.nodeVersion.value.trim() || null,
            git: fields.gitVersion.value.trim() || null,
            codex_cli: fields.codexVersion.value.trim() || null,
            gnu_tools: fields.gnuTools.value.split(",").map((item) => item.trim()).filter(Boolean)
          },
          task_cost_limit_usd: fields.taskCost.value === "" ? null : Number(fields.taskCost.value),
          retention: {
            logs_days: Number(fields.logsDays.value),
            files_days: Number(fields.filesDays.value),
            sensitive_days: fields.sensitiveDays.value === "" ? null : Number(fields.sensitiveDays.value),
            audit_events_expire: false
          }
        };
      }
      function showValidation(result) {
        const box = byId("validation-box");
        box.replaceChildren();
        box.className = "validation show " + (result.valid ? "valid" : "invalid");
        const heading = document.createElement("h3");
        heading.textContent = result.valid ? "Pronto para ativação" : "Ainda faltam alguns itens";
        box.append(heading);
        if (!result.valid) {
          const list = document.createElement("ul");
          result.issues.forEach((issue) => {
            const item = document.createElement("li");
            item.textContent = issue;
            list.append(item);
          });
          box.append(list);
        }
        byId("readiness-value").textContent = result.valid ? "Pronto" : String(result.issues.length);
        byId("readiness-label").textContent = result.valid ? "Validação concluída" : "pendências de ativação";
      }
      function hideValidation() {
        byId("validation-box").className = "validation";
        byId("readiness-value").textContent = "—";
        byId("readiness-label").textContent = "Aguardando validação";
      }
      async function request(path, options = {}) {
        const response = await fetch(path, options);
        const payload = await response.json();
        if (!response.ok) {
          const message = Array.isArray(payload.issues) ? payload.issues.join(" ") : payload.message;
          throw new Error(message || "Falha inesperada");
        }
        return payload;
      }
      async function load() {
        try {
          state.projects = await request("/setup/api/projects");
          if (state.projects.length > 0) selectProject(state.projects[0].id);
          else fill(draftProject(), true);
        } catch (error) {
          toast(error instanceof Error ? error.message : "Falha ao carregar projetos", true);
        }
      }
      byId("new-project").addEventListener("click", () => {
        state.selectedId = null;
        fill(draftProject(), true);
        renderList();
      });
      byId("add-command").addEventListener("click", () => commandRow());
      byId("validate").addEventListener("click", async () => {
        try {
          showValidation(await request("/setup/api/projects/validate", {
            method: "POST",
            headers: { "content-type": "application/json", "x-atlas-setup": "1" },
            body: JSON.stringify(value())
          }));
        } catch (error) {
          toast(error instanceof Error ? error.message : "Falha de validação", true);
        }
      });
      byId("save").addEventListener("click", async () => {
        const button = byId("save");
        button.disabled = true;
        try {
          const saved = await request("/setup/api/projects", {
            method: "PUT",
            headers: { "content-type": "application/json", "x-atlas-setup": "1" },
            body: JSON.stringify(value())
          });
          const index = state.projects.findIndex((project) => project.id === saved.id);
          if (index === -1) state.projects.push(saved);
          else state.projects[index] = saved;
          state.selectedId = saved.id;
          state.creating = false;
          fill(saved);
          renderList();
          toast("Projeto salvo em .atlas/projects.yaml");
        } catch (error) {
          toast(error instanceof Error ? error.message : "Falha ao salvar", true);
        } finally {
          button.disabled = false;
        }
      });
      byId("project-form").addEventListener("input", hideValidation);
      load();
    </script>
  </body>
</html>`;
