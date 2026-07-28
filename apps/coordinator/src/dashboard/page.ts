export const dashboardPage = String.raw`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ATLAS · Visibilidade</title>
  <style>
    :root{color-scheme:dark;--bg:#07110e;--panel:#0f1e19;--line:#244438;--ink:#e9f4ef;--muted:#9bb8ad;--accent:#75e0ad;--warn:#ffc46b}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#123126,var(--bg) 45%);color:var(--ink);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
    header,main{max-width:1280px;margin:auto;padding:24px}header{display:flex;align-items:end;justify-content:space-between;border-bottom:1px solid var(--line)}
    h1,h2{margin:0 0 12px}.eyebrow{color:var(--accent);letter-spacing:.14em;text-transform:uppercase}.muted{color:var(--muted)}
    select,input,button{background:#091611;color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:9px}button{cursor:pointer;color:var(--accent)}
    .grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}.card{background:color-mix(in srgb,var(--panel) 92%,transparent);border:1px solid var(--line);border-radius:10px;padding:16px;overflow:auto}
    .states{grid-column:span 8}.costs{grid-column:span 4}.deliveries{grid-column:1/-1}.tasks,.audit{grid-column:span 7}.detail,.memory{grid-column:span 5}
    .state-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:8px}.state{border-left:3px solid var(--accent);padding:8px;background:#091611}.state strong{font-size:22px;display:block}
    table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}tr[data-id]{cursor:pointer}tr[data-id]:hover{background:#173328}
    pre{white-space:pre-wrap;word-break:break-word}.meter{height:8px;background:#07110e;border-radius:99px;overflow:hidden;margin:8px 0}.meter i{display:block;height:100%;background:var(--accent)}
    #locked{max-width:480px;margin:15vh auto}.hidden{display:none}@media(max-width:850px){.states,.costs,.deliveries,.tasks,.audit,.detail,.memory{grid-column:1/-1}}
  </style>
</head>
<body>
  <section id="locked" class="card"><div class="eyebrow">Acesso local</div><h1>ATLAS Visibilidade</h1><p class="muted">Informe o token local. Ele permanece no fragmento da URL e não é enviado em logs.</p><input id="token" type="password" autocomplete="off" placeholder="DASHBOARD_TOKEN"><button id="unlock">Abrir</button><p id="auth-error"></p></section>
  <div id="app" class="hidden"><header><div><div class="eyebrow">Coordinator · somente leitura</div><h1>Painel operacional</h1></div><label>Projeto <select id="project"></select></label></header>
  <main class="grid"><section class="card states"><h2>Tarefas por estado</h2><div id="states" class="state-grid"></div></section>
  <section class="card costs"><h2>Custos</h2><div id="costs"></div></section>
  <section class="card deliveries"><h2>Entrega terminal</h2><div id="delivery-summary"></div><div id="deliveries"></div></section>
  <section class="card tasks"><h2>Tarefas</h2><div id="tasks"></div></section>
  <section class="card detail"><h2>Detalhe</h2><pre id="detail" class="muted">Selecione uma tarefa.</pre></section>
  <section class="card audit"><h2>AuditEvent</h2><div id="audit"></div></section>
  <section class="card memory"><h2>Memória do projeto</h2><div id="memory"></div></section></main></div>
<script>
let token=new URLSearchParams(location.hash.slice(1)).get("token")||"";
const $=id=>document.getElementById(id); const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(path){const r=await fetch(path,{headers:{authorization:"Bearer "+token}});if(!r.ok)throw new Error(r.status===401?"Token inválido":"Falha "+r.status);return r.json()}
function table(rows,cols,id){return '<table><thead><tr>'+cols.map(c=>'<th>'+esc(c[0])+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr '+(id?'data-id="'+esc(r[id])+'"':'')+'>'+cols.map(c=>'<td>'+esc(r[c[1]])+'</td>').join('')+'</tr>').join('')+'</tbody></table>'}
async function load(){const pid=$("project").value;const q=pid?"?projectId="+encodeURIComponent(pid):"";const [o,t,d]=await Promise.all([api("/dashboard/api/overview"+q),api("/dashboard/api/tasks"+q),api("/dashboard/api/deliveries"+q)]);
if($("project").options.length===0){$("project").innerHTML='<option value="">Todos</option>'+o.projects.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('')}
$("states").innerHTML=o.states.map(s=>'<div class="state"><strong>'+s.count+'</strong>'+esc(s.state)+'</div>').join('');
$("costs").innerHTML=["llm","codex"].map(k=>{const c=o.costs[k],p=Math.min(100,c.spentUsd/c.capUsd*100);return '<p>'+k.toUpperCase()+' · US$ '+c.spentUsd.toFixed(2)+' / '+c.capUsd+'<span class="meter"><i style="width:'+p+'%"></i></span></p>'}).join('');
$("delivery-summary").innerHTML='<p>Pendente: '+o.delivery.pending+' · SLA excedido: '+o.delivery.pendingOverdue+' · Falha: '+o.delivery.deliveryFailed+' · Sem outbox: '+o.delivery.missingOutbox+' · Entregue: '+o.delivery.delivered+'</p>';
$("deliveries").innerHTML=table(d,[["Saúde","health"],["Projeto","projectId"],["Task","taskId"],["Versão","taskVersion"],["Tentativas","attempts"],["Erro seguro","lastError"],["Atualizada","updatedAt"]]);
$("tasks").innerHTML=table(t,[["Estado","state"],["Projeto","projectId"],["Demanda","originalMessage"],["Atualizada","updatedAt"]],"id");document.querySelectorAll("tr[data-id]").forEach(x=>x.onclick=async()=>{$("detail").textContent=JSON.stringify(await api("/dashboard/api/tasks/"+x.dataset.id),null,2)});
if(pid){const [a,m]=await Promise.all([api("/dashboard/api/audit?projectId="+encodeURIComponent(pid)),api("/dashboard/api/memory?projectId="+encodeURIComponent(pid))]);$("audit").innerHTML=table(a,[["Quando","createdAt"],["Ação","action"],["Task","taskId"]]);$("memory").innerHTML=table(m,[["Tipo","type"],["Conteúdo","content"],["Quando","createdAt"]])}else{$("audit").innerHTML=$("memory").innerHTML='<p class="muted">Selecione um projeto.</p>'}}
async function unlock(){token=$("token").value||token;try{await api("/dashboard/api/overview");location.hash="token="+encodeURIComponent(token);$("locked").classList.add("hidden");$("app").classList.remove("hidden");await load()}catch(e){$("auth-error").textContent=e.message}}
$("unlock").onclick=unlock;$("project").onchange=load;if(token)unlock();
</script></body></html>`;
