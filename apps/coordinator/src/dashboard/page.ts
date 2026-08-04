export const dashboardLoginPage = String.raw`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ATLAS · Acesso</title>
  <style>
    :root{color-scheme:light;--bg:#f6f8fb;--panel:#fff;--line:#cbd5e1;--ink:#172033;--muted:#4b5c73;--accent:#2457c5;--danger:#b42318;--shadow:0 24px 70px rgb(15 23 42 / 14%)}
    *{box-sizing:border-box}body{display:grid;min-height:100vh;margin:0;padding:24px;place-items:center;background:var(--bg);color:var(--ink);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
    main{width:min(100%,480px);padding:28px;border:1px solid var(--line);border-radius:14px;background:var(--panel);box-shadow:var(--shadow)}
    h1{margin:0 0 12px;font:700 clamp(28px,7vw,44px)/1.05 ui-sans-serif,system-ui,sans-serif;letter-spacing:-.04em}.eyebrow{margin-bottom:12px;color:var(--accent);letter-spacing:.14em;text-transform:uppercase}.muted{color:var(--muted)}
    form{display:grid;gap:10px;margin-top:24px}input,button{width:100%;padding:11px;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:7px;font:inherit}input:focus-visible,button:focus-visible{outline:3px solid var(--accent);outline-offset:3px}button{cursor:pointer;color:#fff;background:var(--accent);font-weight:700}button:disabled{cursor:wait;opacity:.65}#auth-error{min-height:1.5em;color:var(--danger)}
  </style>
</head>
<body>
  <main><div class="eyebrow">Acesso protegido</div><h1>ATLAS Mission Control</h1><p class="muted">A credencial cria uma sessão temporária em cookie HttpOnly e não é guardada no navegador.</p><form id="login"><label for="credential">Credencial do dono</label><input id="credential" type="password" autocomplete="current-password" required><button id="submit" type="submit">Criar sessão</button></form><p id="auth-error" role="alert" aria-live="polite"></p></main>
<script>
const form=document.getElementById("login"),credential=document.getElementById("credential"),button=document.getElementById("submit"),error=document.getElementById("auth-error");
form.onsubmit=async event=>{event.preventDefault();button.disabled=true;error.textContent="";try{const response=await fetch("/dashboard/auth/session",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({credential:credential.value})});credential.value="";if(!response.ok)throw new Error();location.replace("/dashboard")}catch{error.textContent="Credencial inválida ou acesso indisponível.";button.disabled=false}};
</script></body></html>`;
