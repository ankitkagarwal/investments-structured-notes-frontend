(function () {
  "use strict";
  var cfg = window.APP_CONFIG || {};
  var btn = document.getElementById("pingBtn");
  var out = document.getElementById("result");
  document.getElementById("env").textContent = "Environment: " + (cfg.environment || "unknown");

  function show(msg, cls) { out.textContent = msg; out.className = cls || ""; }

  async function callApi(action, params, token) {
    var body = { v: 1, action: action, params: params || {}, requestId: crypto.randomUUID() };
    if (token) body.token = token;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 30000);
    try {
      var res = await fetch(cfg.apiUrl, { method: "POST", body: JSON.stringify(body), redirect: "follow", signal: ctrl.signal });
      var text = await res.text();
      try { return JSON.parse(text); }
      catch (e) { return { ok: false, error: { code: "NETWORK_ERROR", message: "Unexpected response from the server." } }; }
    } catch (e) {
      return { ok: false, error: { code: "NETWORK_ERROR", message: "Could not reach the server." } };
    } finally { clearTimeout(timer); }
  }

  window.callApi = callApi;

  btn.addEventListener("click", async function () {
    if (!cfg.apiUrl || cfg.apiUrl.indexOf("https://script.google.com/") !== 0) {
      show("config.js has no valid API URL.", "err"); return;
    }
    btn.disabled = true; show("Checking...");
    var r = await callApi("system.ping");
    btn.disabled = false;
    if (r.ok) show("Connected. API v" + r.data.apiVersion + ", " + r.data.environment, "ok");
    else show(r.error.code + ": " + r.error.message, "err");
  });
})();
