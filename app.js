(function () {
  "use strict";
  var cfg = window.APP_CONFIG || {};
  var KEY = "sn_token";
  var token = null, email = "", cooldownTimer = null;

  function $(id) { return document.getElementById(id); }
  var views = { email: $("viewEmail"), code: $("viewCode"), home: $("viewHome") };
  var TITLES = { email: "Sign in", code: "Check your email" };
  var boxes = Array.prototype.slice.call(document.querySelectorAll(".cbox"));

  function getCode() { return boxes.map(function (b) { return b.value; }).join(""); }
  function clearCode() {
    boxes.forEach(function (b) { b.value = ""; });
    $("codeGroup").classList.remove("invalid");
  }
  function fillFrom(i, digits) {
    for (var k = 0; k < digits.length && i + k < boxes.length; k++) boxes[i + k].value = digits.charAt(k);
    boxes[Math.min(i + digits.length, boxes.length - 1)].focus();
  }
  boxes.forEach(function (b, i) {
    b.addEventListener("input", function (ev) {
      $("codeGroup").classList.remove("invalid");
      var d = b.value.replace(/\D/g, "");
      if (ev.inputType === "insertText" && d.length > 1) d = d.slice(-1);
      b.value = "";
      if (d) fillFrom(i, d);
    });
    b.addEventListener("keydown", function (ev) {
      if (ev.key === "Backspace" && b.value === "" && i > 0) {
        ev.preventDefault();
        boxes[i - 1].value = "";
        boxes[i - 1].focus();
      } else if (ev.key === "ArrowLeft" && i > 0) {
        ev.preventDefault(); boxes[i - 1].focus();
      } else if (ev.key === "ArrowRight" && i < boxes.length - 1) {
        ev.preventDefault(); boxes[i + 1].focus();
      }
    });
    b.addEventListener("focus", function () { b.select(); });
  });

  function showView(name) {
    $("viewLoading").hidden = true;
    Object.keys(views).forEach(function (k) { views[k].hidden = (k !== name); });
    $("title").hidden = !TITLES[name];
    $("title").textContent = TITLES[name] || "";
    $("card").classList.toggle("wide", name === "home");
    if (name !== "home") { resetNotes(); resetInvestors(); }
    setMsg("");
    if (name === "email") $("email").focus();
    if (name === "code") { clearCode(); boxes[0].focus(); }
  }

  var badgeSeq = 0;

  var PAGES = { tasks: "Tasks", notes: "Notes", investors: "Investors", payouts: "Payouts", charges: "Charges" };

  function showPage(name) {
    if (!PAGES[name]) name = "tasks";
    $("pageTitle").textContent = PAGES[name];
    var BODY = {
      notes: "Look up a note by its ISIN. Read-only for now.",
      investors: "Search by ID, name or email, or leave blank to list everyone. Read-only for now."
    };
    $("pageBody").textContent = BODY[name] || "Coming soon.";
    $("notesPage").hidden = name !== "notes";
    $("investorsPage").hidden = name !== "investors";
    if (name === "notes") $("isin").focus();
    if (name === "investors") {
      $("invQuery").focus();
      if (!investorsLoaded) loadInvestors("");
    }
    var btns = document.querySelectorAll("#nav .navbtn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("active", btns[i].getAttribute("data-page") === name);
    }
  }

  $("nav").addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-page]");
    if (!b) return;
    var page = b.getAttribute("data-page");
    showPage(page);
    if (page === "tasks") loadTaskBadge();
  });

  function setBadge(text, state, title) {
    var b = $("taskBadge");
    b.textContent = text;
    b.className = "badge" + (state ? " " + state : "");
    b.title = title || "";
  }

  async function loadTaskBadge() {
    var seq = ++badgeSeq, tok = token;
    var first = $("taskBadge").textContent === "...";
    if (first) setBadge("...", "", "Loading tasks");
    else $("taskBadge").title = "Refreshing";
    var r = await callApi("admin.tasks", {}, tok);
    if (seq !== badgeSeq || tok !== token) return; // signed out or superseded meanwhile
    if (r.ok && r.data && r.data.counts && typeof r.data.counts.total === "number") {
      var n = r.data.counts.total;
      setBadge(String(n), n > 0 ? "has-tasks" : "", n + (n === 1 ? " open task" : " open tasks"));
      return;
    }
    if (r.error && r.error.code === "UNAUTHENTICATED") { sessionEnded(); return; }
    setBadge("?", "unknown", "Could not load tasks");
  }

  function sessionEnded() {
    clearToken(); email = "";
    showView("email");
    setMsg("Your session has ended. Please sign in again.");
  }

  var noteSeq = 0;
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== null && text !== undefined) e.textContent = text;
    return e;
  }
  function val(v) { return (v === null || v === undefined || String(v).trim() === "") ? "\u2014" : String(v); }
  function phone(isd, num) { return (isd && num) ? "+" + isd + " " + num : "\u2014"; }
  function facts(obj, keys) {
    var dl = el("dl", "facts");
    keys.forEach(function (k) {
      var key = Array.isArray(k) ? k[0] : k, label = Array.isArray(k) ? k[1] : k;
      var d = el("div");
      d.appendChild(el("dt", null, label));
      d.appendChild(el("dd", null, val(obj[key])));
      dl.appendChild(d);
    });
    return dl;
  }
  function block(title, node) {
    var s = el("section", "block");
    s.appendChild(el("h3", null, title));
    s.appendChild(node);
    return s;
  }
  function table(label, cols, rows) {
    var wrap = el("div", "tablewrap"), t = el("table"), hr = el("tr"), tb = el("tbody");
    t.setAttribute("aria-label", label);
    cols.forEach(function (c) { var th = el("th", null, c); th.scope = "col"; hr.appendChild(th); });
    var thead = el("thead"); thead.appendChild(hr); t.appendChild(thead);
    if (!rows.length) {
      var tr0 = el("tr"), td0 = el("td", null, "None.");
      td0.colSpan = cols.length; tr0.appendChild(td0); tb.appendChild(tr0);
    }
    rows.forEach(function (row) {
      var tr = el("tr");
      row.forEach(function (cell) { tr.appendChild(el("td", null, val(cell))); });
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t);
    return wrap;
  }
  function clearNote() { var r = $("noteResult"); while (r.firstChild) r.removeChild(r.firstChild); }
  function resetNotes() { noteSeq++; clearNote(); $("isin").value = ""; $("isinBtn").disabled = false; }

  function renderNote(d) {
    var h = d.header || {}, profiles = d.profiles || [], byId = {}, out = $("noteResult");
    profiles.forEach(function (p) { byId[p["Investor ID"]] = p; });
    function who(id) {
      var p = byId[id];
      return p ? (String(p["First Name"] || "") + " " + String(p["Last Name"] || "")).trim() + " (" + id + ")" : id;
    }
    clearNote();
    var head = el("div", "notehead");
    head.appendChild(el("h2", null, val(h.ISIN)));
    if (h.Currency) head.appendChild(el("span", "envtag", String(h.Currency)));
    out.appendChild(head);
    out.appendChild(block("Note details", facts(h, ["Initial Fixing Date", "Issue Date", "Term (Months)", "Final Fixing Date", "Redemption Date", "Redemption Barrier %"])));
    out.appendChild(block("Coupon", facts(h, ["Coupon Barrier %", "Yearly Coupon Rate %", "Coupon Frequency (Months)", "Coupon Roll Day", "In-Memory Applicable", "Coupon Barrier Drop %", "Coupon Barrier Drop Start Date", "Coupon Barrier Limit %"])));
    out.appendChild(block("Early Redemption (ER)", facts(h, [
      ["Early Redemption Applicable", "ER Applicable"],
      ["Early Redemption Memory Knock-In Applicable", "ER Memory Knock-In Applicable"],
      ["Early Redemption Start Month", "ER Start Month"],
      ["Early Redemption Frequency", "ER Frequency"],
      ["Early Redemption Barrier %", "ER Barrier %"],
      ["Early Redemption Drop %", "ER Drop %"],
      ["Early Redemption Drop Start Date", "ER Drop Start Date"],
      ["Early Redemption Barrier Limit %", "ER Barrier Limit %"]
    ])));
    out.appendChild(block("Underlyings", table("Underlyings", ["Company", "Exchange", "Ticker", "Buy price"],
      (d.underlyings || []).map(function (u) { return [u["Company Name"], u["Stock Exchange"], u.Ticker, u["Buy Price (Initial Fixing Level)"]]; }))));
    out.appendChild(block("Investments", table("Investments", ["Investment ID", "Investor", "Amount", "NAV%", "Face value", "Start date"],
      (d.investments || []).map(function (x) { return [x.Investment_ID, who(x["Investor ID"]), x.Amount, x["NAV%"], x["Face Value"], x["Start Date"]]; }))));
    out.appendChild(block("Investors", table("Investors", ["Investor ID", "Name", "Email", "Contact", "WhatsApp", "Email consent", "WhatsApp consent", "Coupon consent", "ER consent", "Redemption consent"],
      profiles.map(function (p) {
        return [p["Investor ID"], (String(p["First Name"] || "") + " " + String(p["Last Name"] || "")).trim(), p["Email ID"],
          phone(p["Contact Number ISD Code"], p["Contact Number"]), phone(p["WhatsApp Number ISD Code"], p["WhatsApp Number"]),
          p["Email Consent"], p["WhatsApp Consent"], p["Communication Consent - Coupon Payout"],
          p["Communication Consent - Early Redemption Payout"], p["Communication Consent - Redemption Payout"]];
      }))));
  }

  var investorSeq = 0, investorsLoaded = false;
  function clearInvestors() { var r = $("investorResult"); while (r.firstChild) r.removeChild(r.firstChild); $("invCount").textContent = ""; }
  function resetInvestors() { investorSeq++; investorsLoaded = false; clearInvestors(); $("invQuery").value = ""; $("invBtn").disabled = false; }

  function renderInvestors(list, query) {
    clearInvestors();
    var n = list.length;
    $("invCount").textContent = (n === 1 ? "1 investor" : n + " investors") + (query ? " matching \u201c" + query + "\u201d" : "");
    $("investorResult").appendChild(table("Investors",
      ["Investor ID", "Name", "Email", "Contact", "WhatsApp", "Email consent", "WhatsApp consent", "Coupon consent", "ER consent", "Redemption consent", "Portal access"],
      list.map(function (p) {
        return [p.investorId, (String(p.firstName || "") + " " + String(p.lastName || "")).trim(), p.email,
          phone(p.contactIsdCode, p.contactNumber), phone(p.whatsappIsdCode, p.whatsappNumber),
          p.emailConsent, p.whatsappConsent, p.couponConsent, p.earlyConsent, p.redemptionConsent, p.portalAccess];
      })));
  }

  async function loadInvestors(query) {
    var seq = ++investorSeq, tok = token, btn = $("invBtn");
    busy(btn, true); setMsg("Loading...");
    var r = await callApi("investor.list", { query: query }, tok);
    busy(btn, false);
    if (seq !== investorSeq || tok !== token) return; // signed out or superseded meanwhile
    if (r.ok && r.data && Array.isArray(r.data.investors)) {
      setMsg(""); investorsLoaded = true; renderInvestors(r.data.investors, query); return;
    }
    if (r.error && r.error.code === "UNAUTHENTICATED") { sessionEnded(); return; }
    clearInvestors();
    setMsg(errText(r.error), "err");
  }

  $("investorForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var q = $("invQuery").value.trim();
    if (q.length === 1) { setMsg("Enter at least 2 characters, or leave blank to list everyone.", "err"); return; }
    loadInvestors(q);
  });

  $("isinForm").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var isin = $("isin").value.trim().toUpperCase();
    $("isin").value = isin;
    if (!/^[A-Z0-9]{12}$/.test(isin)) { setMsg("Enter a 12-character ISIN (letters and digits).", "err"); return; }
    var seq = ++noteSeq, tok = token, btn = $("isinBtn");
    busy(btn, true); setMsg("Searching..."); clearNote();
    var r = await callApi("note.get", { isin: isin }, tok);
    busy(btn, false);
    if (seq !== noteSeq || tok !== token) return; // signed out or superseded meanwhile
    if (r.ok && r.data) { setMsg(""); renderNote(r.data); return; }
    if (r.error && r.error.code === "UNAUTHENTICATED") { sessionEnded(); return; }
    if (r.error && r.error.code === "NOT_FOUND") { setMsg("No note found for " + isin + ".", "err"); return; }
    setMsg(errText(r.error), "err");
  });

  function showHome(me) {
    var until = me.expiresAt ? new Date(me.expiresAt).toLocaleString() : "";
    $("whoami").textContent = "Signed in as " + me.subject + " (" + me.role + ")" + (until ? ". Session ends " + until + "." : "");
    showView("home");
    showPage("tasks");
    loadTaskBadge();
  }
  function setMsg(text, cls) { var m = $("msg"); m.textContent = text || ""; m.className = cls || ""; }
  function busy(btn, on) { btn.disabled = on; }

  function saveToken(t) { token = t; try { sessionStorage.setItem(KEY, t); } catch (e) {} }
  function clearToken() { token = null; try { sessionStorage.removeItem(KEY); } catch (e) {} }
  function loadToken() { try { return sessionStorage.getItem(KEY); } catch (e) { return null; } }

  async function callApi(action, params, tok) {
    var body = { v: 1, action: action, params: params || {}, requestId: crypto.randomUUID() };
    if (tok) body.token = tok;
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

  function errText(err) {
    if (!err) return "Something went wrong.";
    if (err.code === "RATE_LIMITED") {
      var s = err.retryAfterSeconds;
      return "Too many attempts. " + (s ? "Try again in " + (s >= 120 ? Math.ceil(s / 60) + " minutes." : s + " seconds.") : "Try again later.");
    }
    if (err.code === "OTP_INVALID") return "That code is not valid or has expired. You can request a new code.";
    return err.message || "Something went wrong.";
  }

  function startCooldown(seconds) {
    var btn = $("resendBtn");
    clearInterval(cooldownTimer);
    var left = seconds;
    function tick() {
      if (left > 0) { btn.disabled = true; btn.textContent = "Send a new code (" + left + "s)"; left--; }
      else { clearInterval(cooldownTimer); btn.disabled = false; btn.textContent = "Send a new code"; }
    }
    tick();
    cooldownTimer = setInterval(tick, 1000);
  }

  async function requestCode(btn) {
    busy(btn, true); setMsg("Sending...");
    var r = await callApi("auth.requestOtp", { email: email });
    busy(btn, false);
    if (r.ok) {
      var mins = Math.round((r.data.expiresInSeconds || 600) / 60);
      $("codeHint").textContent = "If this address is authorised, a code has been sent. It expires in " + mins + " minutes.";
      showView("code");
      startCooldown(r.data.resendAfterSeconds || 60);
    } else {
      setMsg(errText(r.error), "err");
      if (r.error && r.error.code === "RATE_LIMITED" && !views.code.hidden) startCooldown(r.error.retryAfterSeconds || 60);
    }
  }

  $("emailForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var v = $("email").value.trim().toLowerCase();
    if (v.length < 5 || v.indexOf("@") < 1) { setMsg("Enter a valid email address.", "err"); return; }
    email = v;
    requestCode($("sendBtn"));
  });

  $("resendBtn").addEventListener("click", function () { requestCode($("resendBtn")); });
  $("backBtn").addEventListener("click", function () { clearInterval(cooldownTimer); email = ""; showView("email"); });

  $("codeForm").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var code = getCode();
    if (!/^[0-9]{6}$/.test(code)) {
      $("codeGroup").classList.add("invalid");
      setMsg("Enter the 6-digit code.", "err");
      return;
    }
    var btn = $("verifyBtn");
    busy(btn, true); setMsg("Checking...");
    var r = await callApi("auth.verifyOtp", { email: email, code: code });
    busy(btn, false);
    if (r.ok) {
      saveToken(r.data.token);
      clearInterval(cooldownTimer);
      showHome({ role: r.data.role, subject: r.data.subject, expiresAt: r.data.expiresAt });
    } else {
      clearCode();
      $("codeGroup").classList.add("invalid");
      boxes[0].focus();
      setMsg(errText(r.error), "err");
    }
  });

  $("logoutBtn").addEventListener("click", async function () {
    var btn = $("logoutBtn");
    busy(btn, true);
    if (token) await callApi("auth.logout", {}, token);
    busy(btn, false);
    badgeSeq++;
    clearToken(); email = "";
    showView("email");
    setMsg("Signed out.", "ok");
  });

  async function start() {
    if (cfg.environment) {
      $("env").textContent = String(cfg.environment).toUpperCase();
      $("env").hidden = false;
    }
    if (!cfg.apiUrl || cfg.apiUrl.indexOf("https://script.google.com/") !== 0) {
      showView("email"); setMsg("config.js has no valid API URL.", "err"); return;
    }
    var saved = loadToken();
    if (saved) {
      var r = await callApi("auth.me", {}, saved);
      if (r.ok) { token = saved; showHome(r.data); return; }
      clearToken();
      showView("email");
      if (r.error && r.error.code !== "UNAUTHENTICATED") setMsg(errText(r.error), "err");
      else setMsg("Your session has ended. Please sign in again.");
      return;
    }
    showView("email");
  }
  start();
})();
