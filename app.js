(function () {
  "use strict";
  var cfg = window.APP_CONFIG || {};
  var KEY = "sn_token";
  var token = null, email = "", cooldownTimer = null;

  function $(id) { return document.getElementById(id); }
  window.addEventListener("error", function (ev) {
    var l = $("viewLoading");
    if (l && !l.hidden) l.textContent = "The page could not start (" + (ev.message || "script error") + "). Try a hard refresh (Ctrl+Shift+R). If it continues, a file is missing from the site.";
  });
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
  var NOTES_BODY = "Type part of an ISIN or a ticker and pick a note, or enter the full ISIN and press Search. You can add or remove its investments; other details are read-only for now. Use Add note for a new note.";
  var ADD_BODY = "Enter the new note step by step. Nothing is saved until you press Save on the Review step.";

  function showPage(name) {
    if (!PAGES[name]) name = "tasks";
    $("pageTitle").textContent = PAGES[name];
    var BODY = {
      notes: add ? ADD_BODY : NOTES_BODY,
      investors: "Type to filter by ID, name or email. Open an investor to edit, or add a new one."
    };
    $("pageBody").textContent = BODY[name] || "Coming soon.";
    $("notesPage").hidden = name !== "notes";
    $("investorsPage").hidden = name !== "investors";
    if (name === "notes") {
      if (!notesLoaded) loadNotes();
      if (!add) $("isin").focus();
    }
    if (name === "investors") {
      $("invQuery").focus();
      if (!investorsLoaded) loadInvestors(); else filterInvestors();
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

  // ---- Note list for the ISIN search (note.list), loaded once per sign-in, reloaded after a save ----
  var notesList = [], notesLoaded = false, notesFailed = false, noteListSeq = 0;
  var underlyingList = []; // distinct {companyName, stockExchange, ticker} across notes, from note.list
  async function loadNotes() {
    var seq = ++noteListSeq, tok = token;
    notesFailed = false;
    if (isinPicker) isinPicker.refresh();
    var r = await callApi("note.list", {}, tok);
    if (seq !== noteListSeq || tok !== token) return; // signed out or superseded meanwhile
    if (r.ok && r.data && Array.isArray(r.data.notes)) {
      notesList = r.data.notes; notesLoaded = true;
      underlyingList = Array.isArray(r.data.underlyings) ? r.data.underlyings : [];
    } else if (r.error && r.error.code === "UNAUTHENTICATED") {
      sessionEnded(); return;
    } else if (!notesLoaded) {
      notesFailed = true; // a failed reload keeps the list already loaded
    }
    if (isinPicker) isinPicker.refresh();
    if (add && add.u) add.u.rows.forEach(function (r) { r.pickers.forEach(function (p) { p.refresh(); }); });
  }
  var isinPicker = window.NotePicker ? NotePicker.attach($("isin"), {
    source: function () { return notesList; },
    status: function () { return notesLoaded ? "ok" : notesFailed ? "failed" : "loading"; },
    onPick: function () {
      var f = $("isinForm");
      if (f.requestSubmit) f.requestSubmit(); else f.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  }) : null;
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
  function table(label, cols, rows, onOpen) {
    var wrap = el("div", "tablewrap"), t = el("table"), hr = el("tr"), tb = el("tbody");
    t.setAttribute("aria-label", label);
    cols.forEach(function (c) { var th = el("th", null, c); th.scope = "col"; hr.appendChild(th); });
    var thead = el("thead"); thead.appendChild(hr); t.appendChild(thead);
    if (!rows.length) {
      var tr0 = el("tr"), td0 = el("td", null, "None.");
      td0.colSpan = cols.length; tr0.appendChild(td0); tb.appendChild(tr0);
    }
    rows.forEach(function (row, ri) {
      var tr = el("tr");
      row.forEach(function (cell, ci) {
        var td = el("td");
        if (onOpen && ci === 0) {
          var b = el("button", "link rowlink", val(cell));
          b.type = "button";
          b.addEventListener("click", function () { onOpen(ri); });
          td.appendChild(b);
        } else td.textContent = val(cell);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t);
    return wrap;
  }
  function clearNote() { var r = $("noteResult"); while (r.firstChild) r.removeChild(r.firstChild); }
  function resetNotes() {
    noteSeq++; closeModifyPopups(); inv = null; noteData = null; clearNote(); $("isin").value = ""; $("isinBtn").disabled = false;
    noteListSeq++; notesList = []; underlyingList = []; notesLoaded = false; notesFailed = false;
    if (isinPicker) isinPicker.close();
    if (add) leaveAdd();
    holidaySeq++; holidays = null; holidaysFailed = false;
  }

  function renderNote(d) {
    noteData = d; inv = null;
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
    out.appendChild(investmentsSection());
    out.appendChild(block("Investors", table("Investors", ["Investor ID", "Name", "Email", "Contact", "WhatsApp", "Email consent", "WhatsApp consent", "Coupon consent", "ER consent", "Redemption consent"],
      profiles.map(function (p) {
        return [p["Investor ID"], (String(p["First Name"] || "") + " " + String(p["Last Name"] || "")).trim(), p["Email ID"],
          phone(p["Contact Number ISD Code"], p["Contact Number"]), phone(p["WhatsApp Number ISD Code"], p["WhatsApp Number"]),
          p["Email Consent"], p["WhatsApp Consent"], p["Communication Consent - Coupon Payout"],
          p["Communication Consent - Early Redemption Payout"], p["Communication Consent - Redemption Payout"]];
      }))));
  }


  // ---- Modify investments on the Notes page (note.modify: addInvestments, removeInvestmentIds) ----
  // Rules agreed 2026-11-26: investor picked from the list; Amount > 0 with at most 2 decimals;
  // NAV% > 0 with at most 6 decimals (default 100); Face Value = Amount x 100 / NAV%, shown to 2
  // decimals; Start Date a real date, not after the Final Fixing Date; duplicates use the server key
  // (investor, amount 2dp, NAV% 6dp, start date); at least one investment must remain, counting only
  // kept existing rows and complete new rows; Remove marks the row with Undo until Save.
  var noteData = null, inv = null; // inv: edit state while modifying, otherwise null

  function noteWho(id) {
    var ps = (noteData && noteData.profiles) || [];
    for (var i = 0; i < ps.length; i++) {
      if (ps[i]["Investor ID"] === id) return (String(ps[i]["First Name"] || "") + " " + String(ps[i]["Last Name"] || "")).trim() + " (" + id + ")";
    }
    return val(id);
  }
  function money(v) { var n = Number(v); return (v === "" || v == null || !isFinite(n)) ? val(v) : n.toFixed(2); }
  function clearEl(e) { while (e.firstChild) e.removeChild(e.firstChild); }

  function numCheck(text, label, places) {
    var v = String(text == null ? "" : text).trim();
    if (!v) return label + " is required.";
    if (!/^\d+(\.\d+)?$/.test(v)) return label + " must be a number.";
    if ((v.split(".")[1] || "").length > places) return label + " can have at most " + places + " decimals.";
    if (Number(v) <= 0) return label + " must be greater than 0.";
    return "";
  }
  function faceText(a, n) {
    return (numCheck(a, "a", 2) || numCheck(n, "n", 6)) ? "" : (Number(a) * 100 / Number(n)).toFixed(2);
  }
  function investmentKey(investorId, amount, nav, startDate) {
    var d = DateField.parse(startDate);
    return [String(investorId || "").toUpperCase(), Number(amount).toFixed(2), Number(nav).toFixed(6), d ? DateField.format(d) : ""].join("|");
  }

  // A new row nobody has touched (no investor, amount or date, NAV% still 100) is ignored on Save.
  function rowBlank(r) {
    var nav = r.nav.value.trim();
    return !r.picker.getId() && !r.picker.input.value.trim() && !r.amount.value.trim() &&
      (nav === "" || nav === "100") && !r.date.input.value.trim();
  }
  function activeRows() { return inv ? inv.rows.filter(function (r) { return !rowBlank(r); }) : []; }
  function notesDirty() { return !!inv && (activeRows().length > 0 || Object.keys(inv.removed).length > 0); }
  window.addEventListener("beforeunload", function (ev) { if (notesDirty() || addDirty()) { ev.preventDefault(); ev.returnValue = ""; } });

  function closeModifyPopups() {
    if (inv) inv.rows.forEach(function (r) { r.picker.close(); r.date.close(); });
  }

  function investmentsSection() {
    var s = el("section", "block");
    s.id = "invSection";
    showInvestmentsView(s);
    return s;
  }
  function blockHead(title, buttonText, onClick) {
    var head = el("div", "blockhead");
    head.appendChild(el("h3", null, title));
    if (buttonText) {
      var b = el("button", "secondary auto small", buttonText);
      b.type = "button";
      b.addEventListener("click", onClick);
      head.appendChild(b);
    }
    return head;
  }
  function showInvestmentsView(s) {
    clearEl(s);
    s.appendChild(blockHead("Investments", "Modify investments", startModify));
    s.appendChild(table("Investments", ["Investment ID", "Investor", "Amount", "NAV%", "Face value", "Start date"],
      (noteData.investments || []).map(function (x) {
        return [x.Investment_ID, noteWho(x["Investor ID"]), x.Amount, x["NAV%"], money(x["Face Value"]), x["Start Date"]];
      })));
  }

  // The investor list for the picker comes from investor.list (shared with the Investors page).
  async function ensureInvestors() {
    if (investorsLoaded) return { ok: true };
    var tok = token, r = await callApi("investor.list", { query: "" }, tok);
    if (tok !== token) return { ok: false, stale: true };
    if (r.ok && r.data && Array.isArray(r.data.investors)) { allInvestors = r.data.investors; investorsLoaded = true; return { ok: true }; }
    return r;
  }

  async function startModify() {
    if (!window.DateField || !window.InvestorPicker) {
      setMsg("The date or investor field did not load. Hard refresh (Ctrl+Shift+R), and check that datefield.js and investorpick.js are on the site.", "err");
      return;
    }
    var seq = noteSeq, tok = token, btn = this;
    busy(btn, true); setMsg("Loading investors...");
    var r = await ensureInvestors();
    busy(btn, false);
    if (seq !== noteSeq || tok !== token || r.stale) return;
    if (!r.ok) {
      if (r.error && r.error.code === "UNAUTHENTICATED") { sessionEnded(); return; }
      setMsg(errText(r.error), "err"); return;
    }
    setMsg("");
    inv = { rows: [], removed: {}, ffd: String((noteData.header || {})["Final Fixing Date"] || "") };
    renderModify($("invSection"));
  }

  function setInvMsg(text, cls, list) {
    var m = $("invMsg");
    clearEl(m);
    m.className = cls || "";
    if (text) m.appendChild(el("span", null, text));
    if (list && list.length) {
      var ul = el("ul", "errlist");
      list.forEach(function (t) { ul.appendChild(el("li", null, t)); });
      m.appendChild(ul);
    }
  }

  function renderModify(s) {
    clearEl(s);
    s.appendChild(blockHead("Modify investments"));
    s.appendChild(el("p", "muted small count",
      "Add or remove investments for this note. Start Date cannot be after the Final Fixing Date (" + val(inv.ffd) + "). " +
      "A removed investment stays in the sheet marked Removed. Nothing is saved until you press Save changes."));

    var wrap = el("div", "tablewrap"), t = el("table", "edittable"), hr = el("tr"), tb = el("tbody");
    t.setAttribute("aria-label", "Modify investments");
    [["Investment ID", ""], ["Investor", "c-inv"], ["Amount", "c-amt"], ["NAV%", "c-nav"], ["Face value", "c-face"], ["Start date", "c-date"], ["", ""]]
      .forEach(function (c) { var th = el("th", c[1] || null, c[0]); th.scope = "col"; hr.appendChild(th); });
    var thead = el("thead"); thead.appendChild(hr); t.appendChild(thead);
    tb.id = "invBody";
    (noteData.investments || []).forEach(function (x) { tb.appendChild(existingRow(x)); });
    t.appendChild(tb); wrap.appendChild(t); s.appendChild(wrap);

    var add = el("button", "secondary auto small addrow", "+ New investment");
    add.type = "button";
    add.addEventListener("click", function () { addRow(true); });
    s.appendChild(add);

    var pending = el("p", "muted small count"); pending.id = "invPending"; s.appendChild(pending);
    var m = el("div"); m.id = "invMsg"; m.setAttribute("role", "status"); s.appendChild(m);

    var actions = el("div", "actions");
    var save = el("button", "primary inline", "Save changes"); save.type = "button"; save.id = "invSave";
    save.addEventListener("click", saveModify);
    var cancel = el("button", "secondary auto", "Cancel"); cancel.type = "button";
    cancel.addEventListener("click", cancelModify);
    actions.appendChild(save); actions.appendChild(cancel);
    s.appendChild(actions);

    updatePending();
  }

  function existingRow(x) {
    var id = x.Investment_ID, tr = el("tr");
    var idCell = el("td"); idCell.appendChild(el("span", "strike", val(id)));
    var tag = el("span", "tag", "To be removed"); tag.hidden = true; idCell.appendChild(tag);
    tr.appendChild(idCell);
    [noteWho(x["Investor ID"]), x.Amount, x["NAV%"], money(x["Face Value"]), x["Start Date"]].forEach(function (v) {
      var td = el("td"); td.appendChild(el("span", "strike", val(v))); tr.appendChild(td);
    });
    var act = el("td"), b = el("button", "link", "Remove");
    b.type = "button";
    b.setAttribute("aria-label", "Remove " + id);
    b.addEventListener("click", function () { toggleRemove(id, tr, b, tag); });
    act.appendChild(b); tr.appendChild(act);
    return tr;
  }

  function remainingCount() {
    var kept = (noteData.investments || []).filter(function (x) { return !inv.removed[x.Investment_ID]; }).length;
    return kept + inv.rows.filter(function (r) { return !Object.keys(rowErrors(r)).length; }).length;
  }

  function toggleRemove(id, tr, b, tag) {
    if (inv.removed[id]) {
      delete inv.removed[id];
    } else {
      if (remainingCount() - 1 < 1) {
        setInvMsg("At least one investment must remain. Complete a new investment first if you want to replace this one.", "err");
        return;
      }
      inv.removed[id] = true;
    }
    var on = !!inv.removed[id];
    tr.classList.toggle("removing", on);
    tag.hidden = !on;
    b.textContent = on ? "Undo" : "Remove";
    b.setAttribute("aria-label", (on ? "Undo removing " : "Remove ") + id);
    setInvMsg("");
    updatePending();
  }

  function cellInput(cls, attrs) {
    var i = el("input", "cell " + cls);
    Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    return i;
  }
  function errSpan() { var e = el("span", "cellerr"); e.hidden = true; return e; }

  function addRow(focus) {
    var r = {}, tr = el("tr", "newrow");
    r.tr = tr;
    r.idCell = el("td"); r.idCell.appendChild(el("span", "badge newbadge", "New"));
    tr.appendChild(r.idCell);

    var tdI = el("td", "c-inv"), pin = cellInput("pickinput", { "aria-label": "Investor" });
    r.eInv = errSpan(); tdI.appendChild(pin); tdI.appendChild(r.eInv); tr.appendChild(tdI);

    var tdA = el("td", "c-amt");
    r.amount = cellInput("num", { inputmode: "decimal", maxlength: "18", autocomplete: "off", "aria-label": "Amount" });
    r.eAmt = errSpan(); tdA.appendChild(r.amount); tdA.appendChild(r.eAmt); tr.appendChild(tdA);

    var tdN = el("td", "c-nav");
    r.nav = cellInput("num", { inputmode: "decimal", maxlength: "12", autocomplete: "off", "aria-label": "NAV%" });
    r.nav.value = "100";
    r.eNav = errSpan(); tdN.appendChild(r.nav); tdN.appendChild(r.eNav); tr.appendChild(tdN);

    var tdF = el("td", "c-face");
    r.face = cellInput("num", { readonly: "readonly", tabindex: "-1", "aria-label": "Face value (calculated)" });
    tdF.appendChild(r.face); tr.appendChild(tdF);

    var tdD = el("td", "c-date"), din = cellInput("", {});
    r.eDate = errSpan(); tdD.appendChild(din); tdD.appendChild(r.eDate); tr.appendChild(tdD);

    var tdX = el("td"), del = el("button", "link", "Delete");
    del.type = "button";
    del.addEventListener("click", function () { deleteRow(r); });
    tdX.appendChild(del); tr.appendChild(tdX);

    $("invBody").appendChild(tr);
    r.picker = InvestorPicker.attach(pin, { source: function () { return allInvestors; }, loaded: function () { return investorsLoaded; } });
    r.date = DateField.attach(din, { label: "Start Date", required: true, max: inv.ffd || null, maxLabel: "the Final Fixing Date" });
    din.setAttribute("aria-label", "Start Date");

    function refreshFace() { r.face.value = faceText(r.amount.value, r.nav.value); }
    [r.amount, r.nav].forEach(function (i) {
      i.addEventListener("input", function () {
        var c = i.value.replace(/[^\d.]/g, "");
        if (c !== i.value) i.value = c;
        refreshFace(); showRowErrors(r, {}, i === r.amount ? "amount" : "nav"); updatePending();
      });
    });
    r.amount.addEventListener("blur", function () { showRowErrors(r, rowErrors(r), "amount"); updatePending(); });
    r.nav.addEventListener("blur", function () { showRowErrors(r, rowErrors(r), "nav"); updatePending(); });
    pin.addEventListener("investorchange", function () { showRowErrors(r, rowErrors(r), "investor"); updatePending(); });
    din.addEventListener("datechange", function () { showRowErrors(r, rowErrors(r), "date"); updatePending(); });

    inv.rows.push(r);
    renumber();
    refreshFace();
    updatePending();
    if (focus) pin.focus();
  }

  function deleteRow(r) {
    r.picker.close(); r.date.close();
    inv.rows.splice(inv.rows.indexOf(r), 1);
    r.tr.parentNode.removeChild(r.tr);
    renumber(); setInvMsg(""); updatePending();
  }
  function renumber() {
    inv.rows.forEach(function (r, i) { r.no = i + 1; r.idCell.firstChild.textContent = "New " + r.no; });
  }

  function rowErrors(r) {
    var e = {}, a = numCheck(r.amount.value, "Amount", 2), n = numCheck(r.nav.value, "NAV%", 6), d = r.date.check();
    if (!r.picker.getId()) e.investor = "Investor is required.";
    if (a) e.amount = a;
    if (n) e.nav = n;
    if (d) e.date = d;
    return e;
  }
  // Shows the errors for one field (only) or for every field of the row.
  function showRowErrors(r, e, only) {
    [["investor", r.eInv, function (m) { r.picker.setError(m); }],
     ["amount", r.eAmt, function (m) { r.amount.classList.toggle("invalid", !!m); }],
     ["nav", r.eNav, function (m) { r.nav.classList.toggle("invalid", !!m); }],
     ["date", r.eDate, function (m) { r.date.setError(m); }]].forEach(function (f) {
      if (only && only !== f[0]) return;
      var m = e[f[0]] || "";
      f[1].textContent = m; f[1].hidden = !m; f[2](m);
    });
  }

  function updatePending() {
    if (!inv) return;
    var a = activeRows().length, rm = Object.keys(inv.removed).length, p = [];
    if (a) p.push(a + (a === 1 ? " investment" : " investments") + " to add");
    if (rm) p.push(rm + " to remove (" + Object.keys(inv.removed).join(", ") + ")");
    $("invPending").textContent = p.length ? "Pending: " + p.join("; ") + "." : "No changes yet.";
  }

  function cancelModify() {
    if (notesDirty() && !confirm("Discard your unsaved investment changes?")) return;
    closeModifyPopups();
    inv = null;
    showInvestmentsView($("invSection"));
  }

  // Server messages number the new investments "Investment row N"; the screen calls them "New N".
  // Untouched rows are not sent, so the server's row N is the Nth row actually sent.
  function screenText(msg, sent) {
    return String(msg || "").replace(/Investment row (\d+)/g, function (m, n) {
      var r = sent && sent[Number(n) - 1];
      return "New investment " + (r ? r.no : n);
    });
  }

  async function saveModify() {
    var errs = [], removeIds = Object.keys(inv.removed), rows = activeRows();
    if (!rows.length && !removeIds.length) { setInvMsg("No changes to save."); return; }

    inv.rows.forEach(function (r) { if (rowBlank(r)) showRowErrors(r, {}); });
    rows.forEach(function (r) {
      var e = rowErrors(r);
      showRowErrors(r, e);
      Object.keys(e).forEach(function (k) { errs.push("New investment " + r.no + ": " + e[k]); });
    });
    if (!errs.length) {
      var existing = {}, seen = {};
      (noteData.investments || []).forEach(function (x) {
        if (!inv.removed[x.Investment_ID]) existing[investmentKey(x["Investor ID"], x.Amount, x["NAV%"], x["Start Date"])] = x.Investment_ID;
      });
      rows.forEach(function (r) {
        var k = investmentKey(r.picker.getId(), r.amount.value, r.nav.value, r.date.getValue());
        if (existing[k]) errs.push("New investment " + r.no + " matches " + existing[k] + " (same investor, amount, NAV% and start date).");
        else if (seen[k]) errs.push("New investment " + r.no + " matches new investment " + seen[k] + " (same investor, amount, NAV% and start date).");
        else seen[k] = r.no;
      });
    }
    if (!errs.length && remainingCount() < 1) errs.push("At least one investment must remain on the note.");
    if (errs.length) { setInvMsg("Please correct the following:", "err", errs); return; }

    if (removeIds.length) {
      var names = removeIds.map(function (id) {
        var x = (noteData.investments || []).filter(function (y) { return y.Investment_ID === id; })[0];
        return id + (x ? " (" + noteWho(x["Investor ID"]) + ")" : "");
      });
      if (!confirm("Remove " + names.join(", ") + "?\n\nThe investment stays in the sheet marked Removed. Its payouts, charges and messages are kept but no longer shown or processed.")) return;
    }

    var isin = String((noteData.header || {}).ISIN || "").toUpperCase(), seq = noteSeq, tok = token, btn = $("invSave");
    var p = { isin: isin };
    if (rows.length) {
      p.addInvestments = rows.map(function (r) {
        return { investorId: r.picker.getId(), amount: Number(r.amount.value), nav: Number(r.nav.value), startDate: r.date.getValue() };
      });
    }
    if (removeIds.length) p.removeInvestmentIds = removeIds;

    busy(btn, true); setInvMsg("Saving...");
    var r = await callApi("note.modify", p, tok);
    if (seq !== noteSeq || tok !== token || !inv) return;
    if (!r.ok) {
      busy(btn, false);
      if (r.error && r.error.code === "UNAUTHENTICATED") { sessionEnded(); return; }
      if (r.error && r.error.code === "NETWORK_ERROR") {
        setInvMsg("Could not confirm the save. Search for " + isin + " again to see whether the change went through before trying again.", "err");
        return;
      }
      setInvMsg(screenText(errText(r.error), rows), "err");
      return;
    }
    var done = String(r.data && r.data.message || "Saved.");
    if (removeIds.length && r.data && typeof r.data.removed === "number" && r.data.removed !== removeIds.length) {
      done += " " + r.data.removed + " of " + removeIds.length + " removals applied; the others were already removed.";
    }
    closeModifyPopups();
    inv = null;
    loadNotes(); // investment counts changed; refresh the search list in the background
    var g = await callApi("note.get", { isin: isin }, tok);
    if (seq !== noteSeq || tok !== token) return;
    if (g.ok && g.data) { renderNote(g.data); setMsg(done, "ok"); return; }
    if (g.error && g.error.code === "UNAUTHENTICATED") { sessionEnded(); return; }
    showInvestmentsView($("invSection"));
    setMsg(done + " The note could not be refreshed; search for it again.", "ok");
  }

  // ---- Add note (note.add), built one step at a time. Sub-task 1 (2026-11-27): shell + Note step ----
  // Rules agreed 2026-11-27: ISIN 12 letters or digits, not already on the note list; Currency USD, EUR,
  // GBP, CHF or AED (default USD); Initial Fixing <= Issue < Final Fixing <= Redemption Date, all four
  // business days (no weekend, no NYSE holiday); Term a whole number of months > 0; Redemption
  // Barrier % 0 or more. The server (saveAdd / validateHeader_) applies the same rules.
  var ADD_STEPS = [["note", "Note"], ["underlyings", "Underlyings"], ["coupon", "Coupon"],
    ["er", "ER"], ["investments", "Investments"], ["review", "Review"]];
  var ADD_BUILT = { note: true, underlyings: true }; // steps built so far; the rest show a placeholder
  var CURRENCIES = ["USD", "EUR", "GBP", "CHF", "AED"];
  var add = null; // state while adding, otherwise null

  // NYSE holidays (lookup.holidayCalendar), loaded once per sign-in when Add opens.
  var holidays = null, holidaysFailed = false, holidaySeq = 0;
  async function loadHolidays() {
    if (holidays) return;
    var seq = ++holidaySeq, tok = token;
    holidaysFailed = false;
    var r = await callApi("lookup.holidayCalendar", {}, tok);
    if (seq !== holidaySeq || tok !== token) return;
    if (r.ok && r.data && r.data.found && Array.isArray(r.data.dates)) holidays = new Set(r.data.dates);
    else if (r.error && r.error.code === "UNAUTHENTICATED") { sessionEnded(); return; }
    else holidaysFailed = true;
    if (add) { refreshNoteErrors(); renderStepBar(); }
  }
  function isoKey(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

  function addDirty() {
    if (!add) return false;
    var f = add.f;
    return !!(f.isin.value.trim() || f.term.value.trim() || f.rbar.value.trim() || f.currency.value !== "USD" ||
      ["ifd", "issue", "ffd", "red"].some(function (k) { return f[k].getValue(); }) ||
      (add.u && add.u.rows.some(function (r) { return !underlyingBlank(r); })));
  }

  function addField(grid, label, input, hint) {
    var d = el("div", "field");
    var l = el("label", null, label);
    input.id = "add_" + Math.random().toString(36).slice(2, 9);
    l.htmlFor = input.id;
    d.appendChild(l); d.appendChild(input);
    if (hint) d.appendChild(el("span", "muted small fieldhint", hint));
    var e = el("span", "cellerr"); e.hidden = true; d.appendChild(e);
    grid.appendChild(d);
    return e;
  }
  function textInput(attrs) {
    var i = el("input");
    i.type = "text";
    Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    return i;
  }

  function buildNoteStep() {
    var s = el("div"), f = {}, e = {};
    var g1 = el("div", "formgrid");
    f.isin = textInput({ maxlength: "12", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", placeholder: "12 letters or digits" });
    f.isin.classList.add("upper");
    e.isin = addField(g1, "ISIN", f.isin);
    f.currency = el("select");
    CURRENCIES.forEach(function (c) { var o = el("option", null, c); o.value = c; f.currency.appendChild(o); });
    f.currency.value = "USD";
    e.currency = addField(g1, "Currency", f.currency);
    var ifd = textInput(), issue = textInput();
    e.ifd = addField(g1, "Initial Fixing Date", ifd);
    e.issue = addField(g1, "Issue Date", issue);
    f.term = textInput({ inputmode: "numeric", maxlength: "3", autocomplete: "off" });
    e.term = addField(g1, "Term (Months)", f.term);
    s.appendChild(block("Note details", g1));

    var g2 = el("div", "formgrid");
    var ffd = textInput(), red = textInput();
    e.ffd = addField(g2, "Final Fixing Date", ffd);
    e.red = addField(g2, "Redemption Date", red);
    f.rbar = textInput({ inputmode: "decimal", maxlength: "10", autocomplete: "off" });
    e.rbar = addField(g2, "Redemption Barrier %", f.rbar);
    s.appendChild(block("Redemption", g2));
    s.appendChild(el("p", "muted small count", "All four dates must be business days (no weekend or NYSE holiday), in this order: " +
      "Initial Fixing Date, Issue Date, Final Fixing Date, Redemption Date. The Issue Date can equal the Initial Fixing Date, " +
      "and the Redemption Date can equal the Final Fixing Date."));

    // Date fields are attached once the inputs are in the page (DateField wraps each input).
    add.pendingDates = [[ifd, "ifd", "Initial Fixing Date"], [issue, "issue", "Issue Date"],
      [ffd, "ffd", "Final Fixing Date"], [red, "red", "Redemption Date"]];
    add.f = f; add.e = e;

    f.isin.addEventListener("input", function () {
      var c = f.isin.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (c !== f.isin.value) f.isin.value = c;
      showNoteErrors({}, "isin");
    });
    f.term.addEventListener("input", function () {
      var c = f.term.value.replace(/\D/g, "");
      if (c !== f.term.value) f.term.value = c;
      showNoteErrors({}, "term");
    });
    f.rbar.addEventListener("input", function () {
      var c = f.rbar.value.replace(/[^\d.]/g, "");
      if (c !== f.rbar.value) f.rbar.value = c;
      showNoteErrors({}, "rbar");
    });
    ["isin", "term", "rbar"].forEach(function (k) {
      f[k].addEventListener("blur", function () { touch(k); });
    });
    f.currency.addEventListener("change", function () { renderStepBar(); });
    return s;
  }
  function attachNoteDates() {
    add.pendingDates.forEach(function (p) {
      var h = DateField.attach(p[0], { label: p[2], required: true });
      add.f[p[1]] = h;
      p[0].addEventListener("datechange", function () {
        add.touched[p[1]] = true;
        // A date change can fix or break the order of the others, so recheck every touched date.
        refreshNoteErrors();
        renderStepBar();
      });
    });
    add.pendingDates = null;
  }
  function touch(k) { add.touched[k] = true; refreshNoteErrors(); renderStepBar(); }

  function dateRule(h, label, e, key) {
    var m = h.check();
    if (m) { e[key] = m; return null; }
    var d = h.getDate();
    if (d.getDay() === 0 || d.getDay() === 6) { e[key] = label + " must be a business day; weekends are not allowed."; return d; }
    if (holidays && holidays.has(isoKey(d))) e[key] = label + " must be a business day; " + isoKey(d) + " is an NYSE holiday.";
    return d;
  }
  function noteErrors() {
    var f = add.f, e = {};
    var isin = f.isin.value.trim().toUpperCase();
    if (!isin) e.isin = "ISIN is required.";
    else if (!/^[A-Z0-9]{12}$/.test(isin)) e.isin = "ISIN must be 12 letters or digits.";
    else if (notesList.some(function (n) { return String(n.isin).toUpperCase() === isin; })) {
      e.isin = "ISIN " + isin + " already exists. Find it with the search to view or modify it.";
    }
    var ifd = dateRule(f.ifd, "Initial Fixing Date", e, "ifd");
    var issue = dateRule(f.issue, "Issue Date", e, "issue");
    var ffd = dateRule(f.ffd, "Final Fixing Date", e, "ffd");
    var red = dateRule(f.red, "Redemption Date", e, "red");
    if (ifd && issue && !e.issue && issue < ifd) e.issue = "Issue Date cannot be before the Initial Fixing Date.";
    if (issue && ffd && !e.ffd && ffd <= issue) e.ffd = "Final Fixing Date must be after the Issue Date.";
    if (ffd && red && !e.red && red < ffd) e.red = "Redemption Date cannot be before the Final Fixing Date.";
    var t = f.term.value.trim();
    if (!t) e.term = "Term (Months) is required.";
    else if (!/^\d+$/.test(t) || Number(t) <= 0) e.term = "Term (Months) must be a whole number greater than 0.";
    var b = f.rbar.value.trim();
    if (!b) e.rbar = "Redemption Barrier % is required.";
    else if (!/^\d+(\.\d+)?$/.test(b)) e.rbar = "Redemption Barrier % must be a number (0 or more).";
    return e;
  }
  // The calendar check is for the whole step, not one field.
  function calendarProblem() {
    if (holidaysFailed) return "NYSE_Holidays could not be loaded, so business days cannot be checked. Reload the page to try again.";
    if (!holidays) return "The holiday calendar is still loading.";
    return "";
  }
  // Shows errors for touched fields only (all fields once Next or a step change has been tried).
  function refreshNoteErrors() {
    var e = noteErrors(), shown = {};
    Object.keys(e).forEach(function (k) { if (add.touched[k] || add.showAll.note) shown[k] = e[k]; });
    showNoteErrors(shown);
  }
  function showNoteErrors(e, only) {
    var f = add.f;
    ["isin", "currency", "ifd", "issue", "term", "ffd", "red", "rbar"].forEach(function (k) {
      if (only && only !== k) return;
      var m = e[k] || "", span = add.e[k];
      span.textContent = m; span.hidden = !m;
      if (f[k].setError) f[k].setError(m);
      else f[k].classList.toggle("invalid", !!m);
    });
  }

  // Every message that stops Next on a step (the same list decides the step's dot).
  function stepErrorList(key) {
    if (key === "note") {
      var e = noteErrors(), list = Object.keys(e).map(function (k) { return e[k]; });
      var cal = calendarProblem();
      if (cal) list.unshift(cal);
      return list;
    }
    if (key === "underlyings") return underlyingErrorList();
    return [];
  }
  function refreshStepErrors(key) {
    if (key === "note") refreshNoteErrors();
    else if (key === "underlyings") refreshUnderlyingErrors();
  }
  function stepStatus(key) {
    if (!ADD_BUILT[key]) return "";
    if (!stepErrorList(key).length) return "done";
    return add.showAll[key] ? "err" : "";
  }
  // The buttons are built once and only updated here: rebuilding them on a field's blur would
  // swallow the click that caused the blur.
  function renderStepBar() {
    if (!add) return;
    var bar = add.bar;
    if (!bar.children.length) {
      ADD_STEPS.forEach(function (s, i) {
        var b = el("button", "stepbtn");
        b.type = "button";
        b.appendChild(el("span", "stepdot"));
        b.appendChild(el("span", null, (i + 1) + ". " + s[1]));
        b.addEventListener("click", function () { goStep(i, false); });
        bar.appendChild(b);
      });
    }
    ADD_STEPS.forEach(function (s, i) {
      var st = stepStatus(s[0]), b = bar.children[i];
      b.className = "stepbtn" + (st ? " " + st : "");
      if (i === add.step) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
      b.setAttribute("aria-label", s[1] + (st === "done" ? ", complete" : st === "err" ? ", needs attention" : ""));
    });
    var last = add.step === ADD_STEPS.length - 1;
    add.prev.disabled = add.step === 0;
    add.next.hidden = last;
  }

  function setAddMsg(text, cls, list) {
    var m = add.msg;
    clearEl(m);
    m.className = cls || "";
    if (text) m.appendChild(el("span", null, text));
    if (list && list.length) {
      var ul = el("ul", "errlist");
      list.forEach(function (t) { ul.appendChild(el("li", null, t)); });
      m.appendChild(ul);
    }
  }

  // Next checks the current step; picking a step in the bar never blocks, but marks the step left.
  function goStep(i, checked) {
    var key = ADD_STEPS[add.step][0];
    if (ADD_BUILT[key]) {
      add.showAll[key] = true;
      refreshStepErrors(key);
      if (checked) {
        var errs = stepErrorList(key);
        if (errs.length) { setAddMsg("Please correct the following before going on:", "err", errs); renderStepBar(); return; }
      }
    }
    closeAddPopups();
    add.step = i;
    setAddMsg("");
    ADD_STEPS.forEach(function (s, n) { add.panes[s[0]].hidden = n !== i; });
    renderStepBar();
    var first = ADD_STEPS[i][0] === "underlyings" && add.u.rows.length === 1 && underlyingBlank(add.u.rows[0]);
    if (first) add.u.rows[0].company.focus(); else add.bar.querySelectorAll("button")[i].focus();
  }

  // ---- Add note, sub-task 2 (2026-11-27): Underlyings step ----
  // Rules (server validateUnderlying_ + saveAdd): Company letters, digits, spaces and & . ( ) ' - ;
  // Exchange and Ticker letters and digits (max 10, as legacy); Buy Price > 0 with at most 2 decimals;
  // 1 to 20 underlyings; a ticker only once per note (any case). A row left completely blank is ignored.
  var MAX_UNDERLYINGS = 20;
  var COMPANY_RE = /^[A-Za-z0-9 &.()'-]+$/, ALNUM_RE = /^[A-Za-z0-9]+$/, PRICE_RE = /^\d+(\.\d{1,2})?$/;

  function buildUnderlyingsStep() {
    var s = el("div");
    s.appendChild(el("p", "muted small count",
      "Type 2 or more letters of a company or ticker to pick an underlying used on another note; the buy price is always entered here. " +
      "Up to " + MAX_UNDERLYINGS + " underlyings, each ticker once."));
    var wrap = el("div", "tablewrap"), t = el("table", "edittable"), hr = el("tr"), tb = el("tbody");
    t.setAttribute("aria-label", "Underlyings");
    [["#", ""], ["Company", "c-co"], ["Exchange", "c-ex"], ["Ticker", "c-tk"], ["Buy price", "c-bp"], ["", ""]]
      .forEach(function (c) { var th = el("th", c[1] || null, c[0]); th.scope = "col"; hr.appendChild(th); });
    var thead = el("thead"); thead.appendChild(hr); t.appendChild(thead);
    t.appendChild(tb); wrap.appendChild(t); s.appendChild(wrap);
    add.u = { rows: [], body: tb };
    add.u.addBtn = el("button", "secondary auto small addrow", "+ Add underlying");
    add.u.addBtn.type = "button";
    add.u.addBtn.addEventListener("click", function () { addUnderlyingRow(true); });
    s.appendChild(add.u.addBtn);
    return s;
  }

  function addUnderlyingRow(focus) {
    var r = { touched: {} }, tr = el("tr");
    r.tr = tr;
    r.noCell = el("td"); r.noCell.appendChild(el("span", "rowno")); tr.appendChild(r.noCell);
    function cell(cls, input) {
      var td = el("td", cls), e = el("span", "cellerr"); e.hidden = true;
      td.appendChild(input); td.appendChild(e); tr.appendChild(td);
      return e;
    }
    r.company = cellInput("", { maxlength: "100", autocomplete: "off", "aria-label": "Company" });
    r.eCompany = cell("c-co", r.company);
    r.exchange = cellInput("", { maxlength: "10", autocomplete: "off", "aria-label": "Stock exchange" });
    r.eExchange = cell("c-ex", r.exchange);
    r.ticker = cellInput("", { maxlength: "10", autocomplete: "off", "aria-label": "Ticker" });
    r.eTicker = cell("c-tk", r.ticker);
    r.price = cellInput("num", { inputmode: "decimal", maxlength: "10", autocomplete: "off", "aria-label": "Buy price" });
    r.ePrice = cell("c-bp", r.price);
    var tdX = el("td"); r.del = el("button", "link", "Delete"); r.del.type = "button";
    r.del.addEventListener("click", function () { deleteUnderlyingRow(r); });
    tdX.appendChild(r.del); tr.appendChild(tdX);
    add.u.body.appendChild(tr);

    function picked(m) {
      r.company.value = m.companyName; r.exchange.value = m.stockExchange; r.ticker.value = m.ticker;
      ["company", "exchange", "ticker"].forEach(function (k) { r.touched[k] = true; });
      refreshUnderlyingErrors(); renderStepBar();
      r.price.focus();
    }
    r.pickers = window.UnderlyingPicker ? [r.company, r.ticker].map(function (i) {
      return UnderlyingPicker.attach(i, {
        source: function () { return underlyingList; },
        status: function () { return notesLoaded ? "ok" : notesFailed ? "failed" : "loading"; },
        onPick: picked
      });
    }) : [];

    [["company", null], ["exchange", /[^A-Za-z0-9]/g], ["ticker", /[^A-Za-z0-9]/g], ["price", /[^\d.]/g]].forEach(function (p) {
      var i = r[p[0]];
      i.addEventListener("input", function () {
        if (p[1]) { var c = i.value.replace(p[1], ""); if (c !== i.value) i.value = c; }
        showUnderlyingRowErrors(r, {}, p[0]); renderStepBar();
      });
      i.addEventListener("blur", function () { r.touched[p[0]] = true; refreshUnderlyingErrors(); renderStepBar(); });
    });

    add.u.rows.push(r);
    renumberUnderlyings();
    if (focus) r.company.focus();
  }

  function deleteUnderlyingRow(r) {
    if (add.u.rows.length <= 1) return;
    r.pickers.forEach(function (p) { p.close(); });
    add.u.rows.splice(add.u.rows.indexOf(r), 1);
    r.tr.parentNode.removeChild(r.tr);
    renumberUnderlyings(); refreshUnderlyingErrors(); renderStepBar();
  }
  function renumberUnderlyings() {
    add.u.rows.forEach(function (r, i) {
      r.no = i + 1;
      r.noCell.firstChild.textContent = String(i + 1);
      r.del.disabled = add.u.rows.length <= 1;
      r.del.setAttribute("aria-label", "Delete underlying " + (i + 1));
    });
    add.u.addBtn.disabled = add.u.rows.length >= MAX_UNDERLYINGS;
    add.u.addBtn.title = add.u.addBtn.disabled ? "At most " + MAX_UNDERLYINGS + " underlyings" : "";
  }

  function underlyingBlank(r) {
    return !r.company.value.trim() && !r.exchange.value.trim() && !r.ticker.value.trim() && !r.price.value.trim();
  }
  // Returns { perRow: [{field: msg}], general: [msg] } for the rows on screen.
  function underlyingErrors() {
    var perRow = [], general = [], seen = {}, filled = 0;
    add.u.rows.forEach(function (r) {
      var e = {};
      perRow.push(e);
      if (underlyingBlank(r)) return;
      filled++;
      var co = r.company.value.trim(), ex = r.exchange.value.trim(), tk = r.ticker.value.trim(), bp = r.price.value.trim();
      if (!co) e.company = "Company is required.";
      else if (!COMPANY_RE.test(co)) e.company = "Company can contain letters, digits, spaces and & . ( ) ' - only.";
      if (!ex) e.exchange = "Exchange is required.";
      else if (!ALNUM_RE.test(ex)) e.exchange = "Exchange can contain letters and digits only.";
      if (!tk) e.ticker = "Ticker is required.";
      else if (!ALNUM_RE.test(tk)) e.ticker = "Ticker can contain letters and digits only.";
      else if (seen[tk.toUpperCase()]) e.ticker = "Ticker " + tk.toUpperCase() + " is already on underlying " + seen[tk.toUpperCase()] + ".";
      else seen[tk.toUpperCase()] = r.no;
      if (!bp) e.price = "Buy price is required.";
      else if (!PRICE_RE.test(bp)) e.price = "Buy price must be a number with at most 2 decimals.";
      else if (Number(bp) <= 0) e.price = "Buy price must be greater than 0.";
    });
    if (!filled) general.push("At least one underlying is required.");
    return { perRow: perRow, general: general };
  }
  function underlyingErrorList() {
    var u = underlyingErrors(), list = u.general.slice();
    u.perRow.forEach(function (e, i) {
      Object.keys(e).forEach(function (k) { list.push("Underlying " + (i + 1) + ": " + e[k]); });
    });
    return list;
  }
  function refreshUnderlyingErrors() {
    var u = underlyingErrors();
    add.u.rows.forEach(function (r, i) {
      var e = u.perRow[i], shown = {};
      Object.keys(e).forEach(function (k) { if (r.touched[k] || add.showAll.underlyings) shown[k] = e[k]; });
      showUnderlyingRowErrors(r, shown);
    });
  }
  function showUnderlyingRowErrors(r, e, only) {
    [["company", r.eCompany], ["exchange", r.eExchange], ["ticker", r.eTicker], ["price", r.ePrice]].forEach(function (f) {
      if (only && only !== f[0]) return;
      var m = e[f[0]] || "";
      f[1].textContent = m; f[1].hidden = !m;
      r[f[0]].classList.toggle("invalid", !!m);
    });
  }

  function closeAddPopups() {
    if (add && add.f) ["ifd", "issue", "ffd", "red"].forEach(function (k) { if (add.f[k] && add.f[k].close) add.f[k].close(); });
    if (add && add.u) add.u.rows.forEach(function (r) { r.pickers.forEach(function (p) { p.close(); }); });
  }

  function placeholderPane(title) {
    var p = el("div");
    p.appendChild(el("p", "muted", title + " is built in a later step of Notes Add."));
    return p;
  }

  function openAdd() {
    if (!window.DateField) {
      setMsg("The date field did not load. Hard refresh (Ctrl+Shift+R), and check that datefield.js is on the site.", "err");
      return;
    }
    if (notesDirty() && !confirm("Discard your unsaved investment changes?")) return;
    noteSeq++; closeModifyPopups(); inv = null; noteData = null; clearNote();
    if (isinPicker) isinPicker.close();
    $("isin").value = "";
    setMsg("");
    if (!notesLoaded) loadNotes();   // for the duplicate ISIN check and the underlying search
    loadHolidays();

    var host = $("noteAdd");
    clearEl(host);
    add = { step: 0, touched: {}, showAll: {}, panes: {} };
    var back = el("button", "link back", "← Back to search");
    back.type = "button";
    back.addEventListener("click", cancelAdd);
    host.appendChild(back);
    var head = el("div", "notehead"); head.appendChild(el("h2", null, "New note")); host.appendChild(head);
    add.bar = el("div", "steps"); add.bar.setAttribute("aria-label", "Steps");
    host.appendChild(add.bar);
    ADD_STEPS.forEach(function (s) {
      var p = s[0] === "note" ? buildNoteStep() : s[0] === "underlyings" ? buildUnderlyingsStep() : placeholderPane(s[1]);
      p.hidden = s[0] !== "note";
      add.panes[s[0]] = p;
      host.appendChild(p);
    });
    add.msg = el("div"); add.msg.id = "addMsg"; add.msg.setAttribute("role", "status");
    host.appendChild(add.msg);
    var nav = el("div", "stepnav");
    add.prev = el("button", "secondary auto", "‹ Previous"); add.prev.type = "button";
    add.prev.addEventListener("click", function () { goStep(add.step - 1, false); });
    var right = el("div", "stepnav-right");
    var cancel = el("button", "secondary auto", "Cancel"); cancel.type = "button";
    cancel.addEventListener("click", cancelAdd);
    add.next = el("button", "primary inline", "Next ›"); add.next.type = "button";
    add.next.addEventListener("click", function () { goStep(add.step + 1, true); });
    right.appendChild(cancel); right.appendChild(add.next);
    nav.appendChild(add.prev); nav.appendChild(right);
    host.appendChild(nav);

    $("isinForm").hidden = true; $("noteResult").hidden = true; host.hidden = false;
    $("pageBody").textContent = ADD_BODY;
    attachNoteDates();
    addUnderlyingRow(false);
    renderStepBar();
    add.f.isin.focus();
  }

  function leaveAdd() {
    closeAddPopups();
    add = null;
    var host = $("noteAdd");
    clearEl(host); host.hidden = true;
    $("isinForm").hidden = false; $("noteResult").hidden = false;
    $("pageBody").textContent = NOTES_BODY;
  }
  function cancelAdd() {
    if (addDirty() && !confirm("Discard the new note you started?")) return;
    leaveAdd();
    $("isin").focus();
  }

  var investorSeq = 0, investorsLoaded = false, allInvestors = [];
  function clearInvestors() { var r = $("investorResult"); while (r.firstChild) r.removeChild(r.firstChild); $("invCount").textContent = ""; }
  function resetInvestors() {
    investorSeq++; detailSeq++; investorsLoaded = false; allInvestors = [];
    clearInvestors(); $("invQuery").value = ""; $("invBtn").disabled = false;
    showInvestorList();
  }

  // ---- Investor detail and edit (investor.get / investor.update) ----
  var detailSeq = 0, detailSnap = null, detailId = "";
  var EDIT = [["contactIsdCode", "eCIsd"], ["contactNumber", "eCNum"], ["whatsappIsdCode", "eWIsd"], ["whatsappNumber", "eWNum"],
    ["emailConsent", "pill_emailConsent"], ["whatsappConsent", "pill_whatsappConsent"], ["couponConsent", "pill_couponConsent"],
    ["earlyConsent", "pill_earlyConsent"], ["redemptionConsent", "pill_redemptionConsent"]];
  var ISDS = window.IsdField ? { contactIsdCode: IsdField.attach($("eCIsd")), whatsappIsdCode: IsdField.attach($("eWIsd")) } : {};

  // ---- Add mode (investor.add): same form, plus name and email ----
  var IDENT = [["firstName", "eFirst"], ["lastName", "eLast"], ["email", "eEmail"]];
  var CONSENTS = ["emailConsent", "whatsappConsent", "couponConsent", "earlyConsent", "redemptionConsent"];
  var DEFAULT_ISD = "971"; // United Arab Emirates, as in the legacy form
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var NAME_RE = /^[A-Za-z]+$/; // same rule as validateInvestor_ in Code.gs
  var addMode = false, waManual = false, waLast = { isd: "", num: "" };

  function setAddMode(on) {
    addMode = on;
    $("eIdentity").hidden = !on;
    $("dLockNote").hidden = on;
    $("dFacts").hidden = on;
    $("dInvBlock").hidden = on;
    $("dSave").textContent = on ? "Add investor" : "Save changes";
  }

  // Contact ISD and number copy into WhatsApp until WhatsApp is changed by hand.
  // A WhatsApp value that differs from the last copied one means it was edited.
  function syncWa() {
    if (!addMode || waManual || $("dBody").hidden || !ISDS.whatsappIsdCode) return;
    var wIsd = ISDS.whatsappIsdCode.getCode(), wNum = $("eWNum").value;
    if (wIsd !== waLast.isd || wNum !== waLast.num) { waManual = true; return; }
    var cIsd = ISDS.contactIsdCode.getCode(), cNum = $("eCNum").value;
    if (cIsd && cIsd !== wIsd) ISDS.whatsappIsdCode.setCode(cIsd);
    if (cNum !== wNum) $("eWNum").value = cNum;
    waLast = { isd: ISDS.whatsappIsdCode.getCode(), num: $("eWNum").value };
  }
  ["input", "change", "click", "keyup", "focusout"].forEach(function (t) {
    document.addEventListener(t, function () { if (addMode) setTimeout(syncWa, 0); }, true);
  });

  function openAddInvestor() {
    if (!window.IsdField) { setMsg("The country selector did not load. Hard refresh (Ctrl+Shift+R), and check that isd.js and countries.js are on the site.", "err"); return; }
    detailSeq++; detailId = "";
    setMsg(""); setDMsg("");
    $("investorList").hidden = true; $("investorDetail").hidden = false;
    $("dName").textContent = "New investor"; $("dId").textContent = "New";
    setAddMode(true);
    IDENT.forEach(function (p) { $(p[1]).value = ""; });
    setF(["contactIsdCode"], DEFAULT_ISD); setF(["whatsappIsdCode"], DEFAULT_ISD);
    $("eCNum").value = ""; $("eWNum").value = "";
    CONSENTS.forEach(function (k) { setPills($("pill_" + k), "N"); });
    waManual = false;
    waLast = { isd: ISDS.whatsappIsdCode.getCode(), num: "" };
    $("dBody").hidden = false;
    detailSnap = formVals();
    $("eFirst").focus();
  }

  function validateAdd(v) {
    if (!v.firstName) return "First name is required.";
    if (!NAME_RE.test(v.firstName)) return "First name can contain letters A to Z only (no digits, spaces or symbols).";
    if (v.firstName.length > 25) return "First name cannot exceed 25 characters.";
    if (!v.lastName) return "Last name is required.";
    if (!NAME_RE.test(v.lastName)) return "Last name can contain letters A to Z only (no digits, spaces or symbols).";
    if (v.lastName.length > 25) return "Last name cannot exceed 25 characters.";
    if (!v.email) return "Email is required.";
    if (v.email.length > 254 || !EMAIL_RE.test(v.email)) return "Enter a valid email address.";
    return validateEdit(v);
  }

  // Duplicate key is first name + last name + email (as on the server). Checked against the
  // list already in memory, ignoring case; the server check still runs on save.
  function findDuplicate(v) {
    if (!investorsLoaded) return null;
    function key(f, l, e) { return [f, l, e].map(function (s) { return String(s || "").trim().toLowerCase(); }).join("|"); }
    var k = key(v.firstName, v.lastName, v.email);
    for (var i = 0; i < allInvestors.length; i++) {
      var p = allInvestors[i];
      if (key(p.firstName, p.lastName, p.email) === k) return p;
    }
    return null;
  }

  async function submitAdd() {
    syncWa();
    var v = formVals(), bad = validateAdd(v);
    if (bad) { setDMsg(bad, "err"); return; }
    var dup = findDuplicate(v);
    if (dup) { setDMsg("This investor already exists as " + dup.investorId + " (same first name, last name and email).", "err"); return; }
    var seq = ++detailSeq, tok = token, btn = $("dSave"), inv = {};
    IDENT.concat(EDIT).forEach(function (e) { inv[e[0]] = v[e[0]]; });
    busy(btn, true); setDMsg("Adding...");
    var r = await callApi("investor.add", { investor: inv }, tok);
    busy(btn, false);
    if (seq !== detailSeq || tok !== token || !addMode) return;
    if (r.ok && r.data && r.data.investorId) {
      var id = r.data.investorId;
      detailSnap = null; setAddMode(false);
      loadInvestors();
      openInvestor(id, "Investor " + id + " added.");
      return;
    }
    if (r.error && r.error.code === "UNAUTHENTICATED") { sessionEnded(); return; }
    if (r.error && r.error.code === "CONFLICT") { setDMsg("An investor with this first name, last name and email already exists.", "err"); return; }
    setDMsg(errText(r.error), "err");
  }

  function setPills(group, v) {
    Array.prototype.forEach.call(group.querySelectorAll("button"), function (b) {
      b.setAttribute("aria-checked", b.getAttribute("data-v") === v ? "true" : "false");
    });
  }
  function getF(p) {
    if (ISDS[p[0]]) return ISDS[p[0]].getCode();
    var e = $(p[1]);
    if (e.classList.contains("pills")) {
      var b = e.querySelector('[aria-checked="true"]');
      return b ? b.getAttribute("data-v") : "";
    }
    return e.value.trim();
  }
  function setF(p, v) {
    if (ISDS[p[0]]) { ISDS[p[0]].setCode(v); return; }
    var e = $(p[1]);
    if (e.classList.contains("pills")) setPills(e, v); else e.value = v;
  }

  function setDMsg(t, cls) { var m = $("dMsg"); m.textContent = t || ""; m.className = cls || ""; }
  function fmtTs(s) { if (!s) return ""; var d = new Date(s); return isNaN(d.getTime()) ? String(s) : d.toLocaleString(); }
  function formVals() {
    var o = {};
    (addMode ? IDENT.concat(EDIT) : EDIT).forEach(function (p) { o[p[0]] = getF(p); });
    return o;
  }
  function formDirty() {
    if (!detailSnap) return false;
    var v = formVals();
    return Object.keys(detailSnap).some(function (k) { return v[k] !== detailSnap[k]; });
  }
  function showInvestorList() {
    $("investorDetail").hidden = true; $("investorList").hidden = false;
    $("dBody").hidden = true; detailSnap = null; detailId = ""; setDMsg("");
    setAddMode(false);
  }
  function leaveDetail() {
    if (formDirty() && !confirm("Discard unsaved changes?")) return;
    showInvestorList();
  }
  function validateEdit(v) {
    var who = [["contact", "Contact"], ["whatsapp", "WhatsApp"]];
    for (var i = 0; i < who.length; i++) {
      var isd = v[who[i][0] + "IsdCode"], num = v[who[i][0] + "Number"], n = who[i][1];
      if (!/^\d{1,4}$/.test(isd)) return "Choose the " + n + " ISD code from the list.";
      if (!/^\d+$/.test(num)) return n + " number must be digits only.";
      if ((isd + num).length > 15) return n + " number including the ISD code cannot exceed 15 digits.";
    }
    return "";
  }

  function fillDetail(d) {
    var inv = d.investor || {};
    $("dName").textContent = (String(inv.firstName || "") + " " + String(inv.lastName || "")).trim();
    $("dId").textContent = val(inv.investorId);
    var f = $("dFacts"); while (f.firstChild) f.removeChild(f.firstChild);
    var info = { "Email": inv.email, "Portal access": inv.portalAccess, "Created": fmtTs(inv.createdTimestamp), "Last modified": fmtTs(inv.modifiedTimestamp) };
    f.appendChild(facts(info, ["Email", "Portal access", "Created", "Last modified"]));
    EDIT.forEach(function (p) {
      var v = inv[p[0]] == null ? "" : String(inv[p[0]]);
      if (p[0].indexOf("Consent") !== -1 && v !== "Y" && v !== "N") v = "N";
      setF(p, v);
    });
    detailSnap = formVals();
    var host = $("dInv"); while (host.firstChild) host.removeChild(host.firstChild);
    host.appendChild(table("Active investments", ["Investment ID", "ISIN", "Amount", "NAV%", "Face value", "Start date"],
      (d.investments || []).map(function (x) { return [x.investmentId, x.isin, x.amount, x.nav, x.faceValue, x.startDate]; })));
    allInvestors = allInvestors.map(function (p) { return p.investorId === inv.investorId ? inv : p; });
    $("dBody").hidden = false;
  }

  async function openInvestor(id, doneMsg) {
    var seq = ++detailSeq, tok = token;
    setAddMode(false);
    detailId = id; detailSnap = null;
    $("investorList").hidden = true; $("investorDetail").hidden = false; $("dBody").hidden = true;
    $("dName").textContent = ""; $("dId").textContent = id;
    setMsg(""); setDMsg("Loading...");
    var r = await callApi("investor.get", { investorId: id }, tok);
    if (seq !== detailSeq || tok !== token) return;
    if (r.ok && r.data && r.data.investor) {
      if (!window.IsdField) { setDMsg("The country selector did not load. Hard refresh (Ctrl+Shift+R), and check that isd.js and countries.js are on the site.", "err"); return; }
      fillDetail(r.data); setDMsg(doneMsg || "", doneMsg ? "ok" : ""); return;
    }
    if (r.error && r.error.code === "UNAUTHENTICATED") { sessionEnded(); return; }
    showInvestorList();
    setMsg(r.error && r.error.code === "NOT_FOUND" ? "Investor not found. Refresh the list." : errText(r.error), "err");
  }

  $("invBack").addEventListener("click", leaveDetail);
  $("dCancel").addEventListener("click", leaveDetail);
  $("invEditForm").addEventListener("click", function (ev) {
    var b = ev.target.closest(".pills button");
    if (b) setPills(b.parentNode, b.getAttribute("data-v"));
  });
  ["eCNum", "eWNum"].forEach(function (id) {
    $(id).addEventListener("input", function () { var c = this.value.replace(/\D/g, ""); if (c !== this.value) this.value = c; });
  });
  $("invEditForm").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    if (addMode) { submitAdd(); return; }
    var v = formVals(), bad = validateEdit(v);
    if (bad) { setDMsg(bad, "err"); return; }
    if (!formDirty()) { setDMsg("No changes to save."); return; }
    var seq = ++detailSeq, tok = token, id = detailId, btn = $("dSave"), p = { investorId: id };
    EDIT.forEach(function (e) { p[e[0]] = v[e[0]]; });
    busy(btn, true); setDMsg("Saving...");
    var r = await callApi("investor.update", p, tok);
    busy(btn, false);
    if (seq !== detailSeq || tok !== token || detailId !== id) return;
    if (r.ok) {
      var g = await callApi("investor.get", { investorId: id }, tok);
      if (seq !== detailSeq || tok !== token || detailId !== id) return;
      if (g.ok && g.data && g.data.investor) { fillDetail(g.data); setDMsg("Saved.", "ok"); }
      else { detailSnap = v; setDMsg("Saved. The details could not be refreshed.", "ok"); }
      return;
    }
    if (r.error && r.error.code === "UNAUTHENTICATED") { sessionEnded(); return; }
    setDMsg(errText(r.error), "err");
  });

  // Filters the list already in memory: every typed word must appear in the ID, name or email.
  function filterInvestors() {
    var q = $("invQuery").value.trim();
    var tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    var list = tokens.length ? allInvestors.filter(function (p) {
      var hay = [p.investorId, p.firstName, p.lastName, p.email].join(" ").toLowerCase();
      return tokens.every(function (t) { return hay.indexOf(t) !== -1; });
    }) : allInvestors;
    renderInvestors(list, q, allInvestors.length);
  }

  function renderInvestors(list, query, total) {
    clearInvestors();
    var n = list.length;
    $("invCount").textContent = query
      ? n + " of " + total + (total === 1 ? " investor" : " investors")
      : total + (total === 1 ? " investor" : " investors");
    $("investorResult").appendChild(table("Investors",
      ["Investor ID", "Name", "Email", "Contact", "WhatsApp", "Email consent", "WhatsApp consent", "Coupon consent", "ER consent", "Redemption consent", "Portal access"],
      list.map(function (p) {
        return [p.investorId, (String(p.firstName || "") + " " + String(p.lastName || "")).trim(), p.email,
          phone(p.contactIsdCode, p.contactNumber), phone(p.whatsappIsdCode, p.whatsappNumber),
          p.emailConsent, p.whatsappConsent, p.couponConsent, p.earlyConsent, p.redemptionConsent, p.portalAccess];
      }), function (i) { openInvestor(list[i].investorId); }));
  }

  async function loadInvestors() {
    var seq = ++investorSeq, tok = token, btn = $("invBtn");
    busy(btn, true); setMsg("Loading...");
    var r = await callApi("investor.list", { query: "" }, tok);
    busy(btn, false);
    if (seq !== investorSeq || tok !== token) return; // signed out or superseded meanwhile
    if (r.ok && r.data && Array.isArray(r.data.investors)) {
      setMsg(""); investorsLoaded = true; allInvestors = r.data.investors; filterInvestors(); return;
    }
    if (r.error && r.error.code === "UNAUTHENTICATED") { sessionEnded(); return; }
    clearInvestors();
    setMsg(errText(r.error), "err");
  }

  $("investorForm").addEventListener("submit", function (ev) { ev.preventDefault(); });
  $("invQuery").addEventListener("input", function () { if (investorsLoaded) filterInvestors(); });
  $("invQuery").addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && $("invQuery").value) { $("invQuery").value = ""; if (investorsLoaded) filterInvestors(); }
  });
  $("invBtn").addEventListener("click", function () { loadInvestors(); });
  $("invAddBtn").addEventListener("click", openAddInvestor);

  $("noteAddBtn").addEventListener("click", openAdd);

  $("isinForm").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    if (isinPicker) isinPicker.close();
    if (notesDirty() && !confirm("Discard your unsaved investment changes?")) return;
    var isin = $("isin").value.trim().toUpperCase();
    $("isin").value = isin;
    if (!/^[A-Z0-9]{12}$/.test(isin)) { setMsg("Pick a note from the list, or enter a 12-character ISIN (letters and digits).", "err"); return; }
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
    if (notesDirty() && !confirm("Discard your unsaved investment changes and sign out?")) return;
    if (addDirty() && !confirm("Discard the new note you started and sign out?")) return;
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
