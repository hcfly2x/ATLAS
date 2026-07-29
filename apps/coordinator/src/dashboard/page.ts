export const dashboardLoginPage = String.raw`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ATLAS · Acesso</title>
  <style>
    :root{color-scheme:dark;--bg:#07110e;--panel:#0f1e19;--line:#244438;--ink:#e9f4ef;--muted:#9bb8ad;--accent:#75e0ad}
    *{box-sizing:border-box}body{display:grid;min-height:100vh;margin:0;padding:24px;place-items:center;background:radial-gradient(circle at 20% 0,#173a2d,var(--bg) 42%);color:var(--ink);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
    main{width:min(100%,480px);padding:28px;border:1px solid var(--line);border-radius:14px;background:var(--panel);box-shadow:0 16px 40px #0003}
    h1{margin:0 0 12px;font:700 clamp(28px,7vw,44px)/1.05 ui-sans-serif,system-ui,sans-serif;letter-spacing:-.04em}.eyebrow{margin-bottom:12px;color:var(--accent);letter-spacing:.14em;text-transform:uppercase}.muted{color:var(--muted)}
    form{display:grid;gap:10px;margin-top:24px}input,button{width:100%;padding:11px;background:#091611;color:var(--ink);border:1px solid var(--line);border-radius:7px;font:inherit}button{cursor:pointer;color:var(--accent)}button:disabled{cursor:wait;opacity:.65}#auth-error{min-height:1.5em;color:#ffb2aa}
  </style>
</head>
<body>
  <main><div class="eyebrow">Acesso protegido</div><h1>ATLAS Mission Control</h1><p class="muted">A credencial cria uma sessão temporária em cookie HttpOnly e não é guardada no navegador.</p><form id="login"><label for="credential">Credencial do dono</label><input id="credential" type="password" autocomplete="current-password" required><button id="submit" type="submit">Criar sessão</button></form><p id="auth-error" role="alert" aria-live="polite"></p></main>
<script>
const form=document.getElementById("login"),credential=document.getElementById("credential"),button=document.getElementById("submit"),error=document.getElementById("auth-error");
form.onsubmit=async event=>{event.preventDefault();button.disabled=true;error.textContent="";try{const response=await fetch("/dashboard/auth/session",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({credential:credential.value})});credential.value="";if(!response.ok)throw new Error();location.replace("/dashboard")}catch{error.textContent="Credencial inválida ou acesso indisponível.";button.disabled=false}};
</script></body></html>`;

export const dashboardPage = String.raw`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ATLAS · Mission Control</title>
  <style>
    :root{color-scheme:dark;--bg:#07110e;--panel:#0f1e19;--panel-2:#132720;--line:#244438;--ink:#e9f4ef;--muted:#9bb8ad;--accent:#75e0ad;--warn:#ffc46b;--danger:#ff8c82;--blue:#80bfff}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 0,#173a2d,var(--bg) 42%);color:var(--ink);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
    header,main{max-width:1320px;margin:auto;padding:24px}header{display:flex;align-items:end;justify-content:space-between;gap:20px;border-bottom:1px solid var(--line)}
    h1,h2,h3,p{margin-top:0}h1{font:700 clamp(26px,4vw,44px)/1.05 ui-sans-serif,system-ui,sans-serif;letter-spacing:-.04em}h2{font:650 18px/1.2 ui-sans-serif,system-ui,sans-serif}
    .eyebrow{color:var(--accent);letter-spacing:.14em;text-transform:uppercase}.muted{color:var(--muted)}.stamp{font-size:12px;color:var(--muted)}
    select,input,button{background:#091611;color:var(--ink);border:1px solid var(--line);border-radius:7px;padding:10px}button{cursor:pointer;color:var(--accent)}
    .grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}.card{background:color-mix(in srgb,var(--panel) 94%,transparent);border:1px solid var(--line);border-radius:14px;padding:18px;overflow:auto;box-shadow:0 16px 40px #0003}
    .intelligence,.priority,.risks,.operations{grid-column:1/-1}.attention,.running,.blocked,.completed{grid-column:span 6}.summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin-top:18px}
    .fact,.work-item,.alert{background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:12px}.fact strong{display:block;font:700 26px/1 ui-sans-serif,system-ui,sans-serif;margin-bottom:6px}
    .priority{border-color:color-mix(in srgb,var(--accent) 60%,var(--line))}.priority-main{font:700 clamp(20px,3vw,32px)/1.15 ui-sans-serif,system-ui,sans-serif;margin-bottom:8px}
    .list{display:grid;gap:10px}.work-head,.alert-head{display:flex;justify-content:space-between;gap:12px;align-items:start}.pill{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:2px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
    .severity-critical,.severity-high{color:var(--danger);border-color:var(--danger)}.severity-medium{color:var(--warn);border-color:var(--warn)}.severity-info{color:var(--blue);border-color:var(--blue)}
    .indeterminate{border-style:dashed;color:var(--muted)}.section-note{font-size:12px;color:var(--muted)}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px;border-bottom:1px solid var(--line);vertical-align:top}tr[data-id]{cursor:pointer}tr[data-id]:hover{background:#173328}
    pre{white-space:pre-wrap;word-break:break-word;background:#091611;border-radius:8px;padding:12px}.state-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(135px,1fr));gap:8px;margin-bottom:18px}.state{border-left:3px solid var(--accent);padding:8px;background:#091611}.state strong{font-size:20px;display:block}
    @media(max-width:850px){header{align-items:start;flex-direction:column}.attention,.running,.blocked,.completed{grid-column:1/-1}}
  </style>
</head>
<body>
  <div id="app">
    <header><div><div class="eyebrow">Coordinator · somente leitura</div><h1>Mission Control</h1><p class="muted">Trabalho, decisões e riscos derivados dos registros existentes.</p></div><label>Projeto <select id="project"><option value="">Todos</option></select></label></header>
    <main class="grid">
      <section class="card intelligence"><div class="eyebrow">Atlas Intelligence · regras determinísticas</div><h2 id="headline">Carregando sinais…</h2><div id="facts" class="summary-grid"></div><p id="coverage" class="section-note"></p></section>
      <section class="card priority"><div class="eyebrow">Prioridade agora</div><div id="priority" class="priority-main">Carregando…</div><p id="priority-meta" class="muted"></p></section>
      <section class="card attention"><h2>Precisa de você</h2><div id="attention" class="list"></div></section>
      <section class="card running"><h2>Em execução</h2><div id="running" class="list"></div></section>
      <section class="card blocked"><h2>Parado ou bloqueado</h2><div id="blocked" class="list"></div></section>
      <section class="card completed"><h2>Concluído recentemente</h2><div id="completed" class="list"></div></section>
      <section class="card risks"><h2>Proatividade · riscos derivados</h2><p class="section-note">Alertas apenas informativos; nenhum deles executa ação, reenvio ou aprovação.</p><div id="risks" class="list"></div></section>
      <section class="card operations"><h2>Visão operacional segura</h2><div id="states" class="state-grid"></div><h3>Entrega terminal</h3><div id="delivery-summary"></div><div id="deliveries"></div><h3>Tarefas</h3><div id="tasks"></div><h3>Detalhe seguro</h3><pre id="detail" class="muted">Selecione uma tarefa.</pre></section>
    </main>
  </div>
<script>
const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const when=v=>v?new Date(v).toLocaleString("pt-BR"):"—";
async function api(path){const r=await fetch(path,{credentials:"same-origin"});if(r.status===401){location.replace("/dashboard/login");throw new Error("Sessão expirada")}if(!r.ok)throw new Error("Falha "+r.status);return r.json()}
function table(rows,cols,id){if(!rows.length)return '<p class="muted">Nenhum registro.</p>';return '<table><thead><tr>'+cols.map(c=>'<th>'+esc(c[0])+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr '+(id?'data-id="'+esc(r[id])+'"':'')+'>'+cols.map(c=>'<td>'+esc(c[2]?c[2](r[c[1]]):r[c[1]])+'</td>').join('')+'</tr>').join('')+'</tbody></table>'}
function unavailable(target){$(target).innerHTML='<div class="work-item indeterminate">Sinal indeterminado.</div>'}
function renderActions(target,block){if(block.status!=="available"){unavailable(target);return}if(!block.items.length){$(target).innerHTML='<p class="muted">Nenhum item derivado.</p>';return}$(target).innerHTML=block.items.map(x=>'<article class="alert"><div class="alert-head"><strong>'+esc(x.label)+'</strong><span class="pill severity-'+esc(x.severity)+'">'+esc(x.severity)+'</span></div><div class="muted">Task '+esc(x.taskId)+' · '+esc(x.source.type)+' '+esc(x.source.id)+'</div><div class="stamp">'+esc(when(x.occurredAt))+'</div></article>').join('')}
function renderWork(target,block){if(block.status!=="available"){unavailable(target);return}if(!block.items.length){$(target).innerHTML='<p class="muted">Nenhuma tarefa neste bloco.</p>';return}$(target).innerHTML=block.items.map(x=>'<article class="work-item"><div class="work-head"><strong>'+esc(x.state)+'</strong><span class="pill">'+esc(x.complexity??"não classificada")+'</span></div><div>Task '+esc(x.taskId)+' · v'+esc(x.version)+'</div><div class="muted">Progresso: etapa '+esc(x.progress.stage)+' · ETA: '+esc(x.eta)+'</div><div class="stamp">'+esc(when(x.updatedAt))+'</div></article>').join('')}
async function loadMission(q){try{const m=await api("/dashboard/api/mission-control"+q);$("headline").textContent=m.intelligence.headline;$("facts").innerHTML=m.intelligence.facts.map(f=>'<div class="fact"><strong>'+esc(f.value)+'</strong>'+esc(f.label)+'</div>').join('');$("coverage").textContent=m.unavailableSignals.length?"Cobertura parcial · sinais indisponíveis: "+m.unavailableSignals.join(", "):"Todos os sinais consultados estão disponíveis.";(m.priorityNow.status==="available"&&m.priorityNow.item)?($("priority").textContent=m.priorityNow.item.label,$("priority-meta").textContent="Task "+m.priorityNow.item.taskId+" · "+m.priorityNow.item.source.type+" "+m.priorityNow.item.source.id):($("priority").textContent=m.priorityNow.status==="available"?"Nenhuma ação prioritária derivada":"indeterminado",$("priority-meta").textContent="");renderActions("attention",m.needsAttention);renderWork("running",m.inProgress);renderWork("blocked",m.blocked);renderWork("completed",m.recentlyCompleted);renderActions("risks",m.risks)}catch(e){$("headline").textContent="indeterminado";$("coverage").textContent="A projeção principal está indisponível.";["attention","running","blocked","completed","risks"].forEach(unavailable);$("priority").textContent="indeterminado"}}
async function loadOperations(q){const [overview,tasks,deliveries]=await Promise.allSettled([api("/dashboard/api/overview"+q),api("/dashboard/api/tasks"+q),api("/dashboard/api/deliveries"+q)]);if(overview.status==="fulfilled"){const o=overview.value;if($("project").options.length===1)$("project").innerHTML='<option value="">Todos</option>'+o.projects.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('');$("states").innerHTML=o.states.map(s=>'<div class="state"><strong>'+s.count+'</strong>'+esc(s.state)+'</div>').join('');$("delivery-summary").innerHTML='<p>Pendente: '+o.delivery.pending+' · SLA excedido: '+o.delivery.pendingOverdue+' · Falha: '+o.delivery.deliveryFailed+' · Sem outbox: '+o.delivery.missingOutbox+' · Entregue: '+o.delivery.delivered+'</p>'}else{$("states").innerHTML='<p class="muted">Estados indisponíveis.</p>';$("delivery-summary").innerHTML='<p class="muted">Resumo de entrega indeterminado.</p>'}if(deliveries.status==="fulfilled")$("deliveries").innerHTML=table(deliveries.value,[["Saúde","health"],["Projeto","projectId"],["Task","taskId"],["Versão","taskVersion"],["Tentativas","attempts"],["Código seguro","lastError"],["Atualizada","updatedAt",when]]);else $("deliveries").innerHTML='<p class="muted">Entregas indisponíveis.</p>';if(tasks.status==="fulfilled"){$("tasks").innerHTML=table(tasks.value,[["Estado","state"],["Projeto","projectId"],["Task","id"],["Complexidade","complexity"],["Atualizada","updatedAt",when]],"id");document.querySelectorAll("tr[data-id]").forEach(x=>x.onclick=async()=>{try{$("detail").textContent=JSON.stringify(await api("/dashboard/api/tasks/"+x.dataset.id),null,2)}catch(e){$("detail").textContent="Detalhe indeterminado."}})}else $("tasks").innerHTML='<p class="muted">Tarefas indisponíveis.</p>'}
async function load(){const pid=$("project").value;const q=pid?"?projectId="+encodeURIComponent(pid):"";await Promise.allSettled([loadMission(q),loadOperations(q)])}
$("project").onchange=load;void load();
</script></body></html>`;
