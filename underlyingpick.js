/*
 * underlyingpick.js: suggest an existing underlying while typing a company name or ticker.
 * Same pattern as notepick.js: one shared popup, UnderlyingPicker.attach(input, options).
 * Searches the distinct underlying list that note.list already returns, in the browser
 * (2026-11-27: replaces a lookup.searchUnderlyings call per keystroke, which was slow).
 *
 * Behaviour matches the legacy Index.html underlying lookup on the Underlyings tab:
 *  - nothing below 2 characters; up to 20 matches
 *  - each line: company in bold, then ticker · exchange
 *  - Up/Down wrap, Enter picks the highlighted line, Escape closes, clicking keeps focus in the field
 *  - picking fills company, exchange and ticker (not the buy price, which is note-specific)
 *  - no match closes the list; the fields stay free text
 * Changed: instant (no server call); every typed word must appear in the company or ticker;
 * the list is exactly as wide as its field; while the list is loading or if it failed, a line says so.
 *
 * options: source() -> [{companyName, stockExchange, ticker}], status() -> "ok" | "loading" | "failed",
 * onPick(match).
 */
(function () {
  "use strict";
  var MIN = 2, MAX = 20;
  var pop = document.createElement("div");
  pop.id = "underlyingPopup";
  pop.className = "isdpop pickpop";
  pop.setAttribute("role", "listbox");
  pop.hidden = true;
  document.body.appendChild(pop);
  var cur = null; // the picker whose list is open

  function position() {
    if (!cur) return;
    var r = cur.input.getBoundingClientRect();
    var w = Math.min(r.width, window.innerWidth - 16);
    pop.style.width = w + "px";
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + "px";
    pop.style.top = r.bottom + 4 + "px";
    var h = pop.offsetHeight;
    if (r.bottom + 4 + h > window.innerHeight - 8) pop.style.top = Math.max(8, r.top - h - 4) + "px";
  }

  function render() {
    while (pop.firstChild) pop.removeChild(pop.firstChild);
    if (!cur.matches.length) {
      var s = document.createElement("div");
      s.className = "isdempty";
      s.textContent = cur.status() === "failed" ? "The underlying list could not be loaded. Enter the details yourself."
        : "The underlying list is still loading.";
      pop.appendChild(s);
      cur.input.removeAttribute("aria-activedescendant");
      return;
    }
    cur.matches.forEach(function (m, i) {
      var o = document.createElement("div");
      o.id = "undOpt" + i;
      o.className = "isdopt pickopt" + (i === cur.active ? " active" : "");
      o.setAttribute("role", "option");
      o.setAttribute("aria-selected", i === cur.active ? "true" : "false");
      var b = document.createElement("strong");
      b.textContent = m.companyName || m.ticker;
      var sp = document.createElement("span");
      sp.textContent = [m.ticker, m.stockExchange].filter(Boolean).join(" · ");
      o.appendChild(b); o.appendChild(sp);
      o.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
      o.addEventListener("click", function () { pick(cur, m); });
      pop.appendChild(o);
    });
    if (cur.active >= 0) {
      cur.input.setAttribute("aria-activedescendant", "undOpt" + cur.active);
      var el = document.getElementById("undOpt" + cur.active);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    } else cur.input.removeAttribute("aria-activedescendant");
  }

  function show(st) {
    if (cur && cur !== st) cur.input.setAttribute("aria-expanded", "false");
    cur = st;
    pop.hidden = false;
    st.input.setAttribute("aria-expanded", "true");
    render();
    position();
  }
  function close() {
    pop.hidden = true;
    if (cur) { cur.input.setAttribute("aria-expanded", "false"); cur.input.removeAttribute("aria-activedescendant"); }
    cur = null;
  }
  function isOpen() { return !pop.hidden && !!cur; }

  function search(list, q) {
    var tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    return list.filter(function (m) {
      var hay = (String(m.companyName || "") + " " + String(m.ticker || "")).toLowerCase();
      return tokens.every(function (t) { return hay.indexOf(t) !== -1; });
    }).slice(0, MAX);
  }
  // Opens the list for the current text; no match closes it (as legacy), unless the list is not ready.
  function open(st) {
    var q = String(st.input.value).trim();
    if (q.length < MIN) { if (cur === st) close(); return; }
    st.matches = search(st.source(), q);
    st.active = -1;
    if (!st.matches.length && st.status() === "ok") { if (cur === st) close(); return; }
    show(st);
  }

  function pick(st, m) {
    close();
    st.onPick({ companyName: String(m.companyName || ""), stockExchange: String(m.stockExchange || ""), ticker: String(m.ticker || "") });
  }

  function attach(input, options) {
    var o = options || {};
    var st = {
      input: input, matches: [], active: -1,
      source: function () { return (o.source && o.source()) || []; },
      status: function () { return o.status ? o.status() : "ok"; },
      onPick: function (m) { if (o.onPick) o.onPick(m); }
    };
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", "underlyingPopup");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");

    input.addEventListener("input", function () { open(st); });
    input.addEventListener("blur", function () {
      setTimeout(function () {
        if (document.activeElement === input) return;
        if (cur === st) close();
      }, 120);
    });
    input.addEventListener("keydown", function (ev) {
      var k = ev.key;
      if (!isOpen() || cur !== st || !st.matches.length) return;
      if (k === "ArrowDown" || k === "ArrowUp") {
        ev.preventDefault();
        var n = st.matches.length;
        if (!n) return;
        st.active = k === "ArrowDown" ? (st.active + 1) % n : (st.active - 1 + n) % n;
        render();
      } else if (k === "Enter" && st.active >= 0) {
        ev.preventDefault();
        pick(st, st.matches[st.active]);
      } else if (k === "Escape") {
        ev.preventDefault(); ev.stopPropagation();
        close();
      }
    });

    return {
      input: input,
      refresh: function () { if (cur === st && isOpen()) open(st); },
      close: function () { if (cur === st) close(); }
    };
  }

  window.addEventListener("scroll", function (ev) {
    if (isOpen() && !(ev.target instanceof Node && pop.contains(ev.target))) close();
  }, true);
  window.addEventListener("resize", function () { if (isOpen()) close(); });
  window.UnderlyingPicker = { attach: attach };
})();
