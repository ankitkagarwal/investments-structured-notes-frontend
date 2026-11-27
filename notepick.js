/*
 * notepick.js: find a note on the Notes page by typing part of an ISIN or a ticker.
 * Same pattern as investorpick.js: one shared popup, NotePicker.attach(input, options).
 *
 * Legacy Index.html had no lookup here (the full ISIN had to be typed). Behaviour:
 *  - searches the note list already loaded (note.list); opens from the first character
 *  - every typed word must appear in the ISIN or one of the tickers, ignoring case; up to 20 matches
 *  - each line: ISIN in bold, then tickers · currency · FFD dd/mm/yyyy · n investments
 *  - Up/Down wrap, Enter picks the highlighted line (or the only match), Escape closes,
 *    clicking an option keeps focus in the field; the list is exactly as wide as its field
 *  - free text stays allowed: with nothing highlighted, Enter submits the form as before,
 *    so a full 12-character ISIN can still be typed and searched
 *
 * options: source() -> notes[], status() -> "ok" | "loading" | "failed", onPick(note).
 */
(function () {
  "use strict";
  var MIN = 1, MAX = 20;
  var pop = document.createElement("div");
  pop.id = "notePopup";
  pop.className = "isdpop pickpop";
  pop.setAttribute("role", "listbox");
  pop.hidden = true;
  document.body.appendChild(pop);
  var cur = null; // the picker whose list is open

  function isinOf(n) { return String(n.isin || "").toUpperCase(); }

  function detail(n) {
    var parts = [];
    var t = (n.tickers || []).join(", ");
    if (t) parts.push(t);
    if (n.currency) parts.push(String(n.currency));
    if (n.finalFixingDate) parts.push("FFD " + n.finalFixingDate);
    var k = Number(n.activeInvestments) || 0;
    parts.push(k + (k === 1 ? " investment" : " investments"));
    return parts.join(" · ");
  }

  function search(list, q) {
    var text = String(q || "").trim();
    if (text.length < MIN) return [];
    var tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
    return list.filter(function (n) {
      var hay = [n.isin].concat(n.tickers || []).join(" ").toLowerCase();
      return tokens.every(function (t) { return hay.indexOf(t) !== -1; });
    }).slice(0, MAX);
  }

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
      var none = document.createElement("div");
      none.className = "isdempty";
      var s = cur.status();
      none.textContent = s === "loading" ? "The note list is still loading."
        : s === "failed" ? "The note list could not be loaded. Type the full ISIN and press Search."
        : "No matching note.";
      pop.appendChild(none);
      cur.input.removeAttribute("aria-activedescendant");
      return;
    }
    cur.matches.forEach(function (n, i) {
      var o = document.createElement("div");
      o.id = "noteOpt" + i;
      o.className = "isdopt pickopt" + (i === cur.active ? " active" : "");
      o.setAttribute("role", "option");
      o.setAttribute("aria-selected", i === cur.active ? "true" : "false");
      var b = document.createElement("strong");
      b.textContent = isinOf(n);
      var sp = document.createElement("span");
      sp.textContent = detail(n);
      o.appendChild(b); o.appendChild(sp);
      o.addEventListener("mousedown", function (ev) { ev.preventDefault(); }); // keep focus in the input
      o.addEventListener("click", function () { pick(cur, n); });
      pop.appendChild(o);
    });
    if (cur.active >= 0) {
      cur.input.setAttribute("aria-activedescendant", "noteOpt" + cur.active);
      var el = document.getElementById("noteOpt" + cur.active);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    } else cur.input.removeAttribute("aria-activedescendant");
  }

  function open(st) {
    if (String(st.input.value).trim().length < MIN) { if (cur === st) close(); return; }
    if (cur && cur !== st) cur.input.setAttribute("aria-expanded", "false");
    cur = st;
    st.matches = search(st.source(), st.input.value);
    st.active = -1;
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

  function pick(st, n) {
    st.input.value = isinOf(n);
    close();
    st.onPick(n);
  }

  // True when the field already holds exactly one listed ISIN (nothing left to suggest).
  function exact(st) {
    var v = String(st.input.value).trim().toUpperCase(), list = st.source();
    for (var i = 0; i < list.length; i++) if (isinOf(list[i]) === v) return true;
    return false;
  }

  function attach(input, options) {
    var o = options || {};
    var st = {
      input: input, matches: [], active: -1,
      source: function () { return (o.source && o.source()) || []; },
      status: function () { return o.status ? o.status() : "ok"; },
      onPick: function (n) { if (o.onPick) o.onPick(n); }
    };
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", "notePopup");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");

    input.addEventListener("input", function () { open(st); });
    input.addEventListener("focus", function () { if (!exact(st)) open(st); });
    input.addEventListener("blur", function () {
      setTimeout(function () {
        if (document.activeElement === input) return;
        if (cur === st) close();
      }, 120);
    });
    input.addEventListener("keydown", function (ev) {
      var k = ev.key;
      if (k === "ArrowDown" || k === "ArrowUp") {
        if (!isOpen() || cur !== st) { open(st); if (!isOpen()) return; }
        ev.preventDefault();
        var n = st.matches.length;
        if (!n) return;
        st.active = k === "ArrowDown" ? (st.active + 1) % n : (st.active - 1 + n) % n;
        render();
      } else if (k === "Enter" && isOpen() && cur === st) {
        if (st.active >= 0) { ev.preventDefault(); pick(st, st.matches[st.active]); }
        else if (st.matches.length === 1) { ev.preventDefault(); pick(st, st.matches[0]); }
        else close(); // nothing chosen: let the form submit the typed text as before
      } else if (k === "Escape" && isOpen() && cur === st) {
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
  window.NotePicker = { attach: attach };
})();
