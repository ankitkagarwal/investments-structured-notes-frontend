/*
 * investorpick.js: pick an existing investor by typing an ID, name or email.
 * Same pattern as isd.js: one shared popup, InvestorPicker.attach(input, options).
 *
 * Behaviour matches the legacy Index.html investor lookup on the Investments tab:
 *  - nothing below 2 characters; up to 20 matches; ID in bold, then name and email
 *  - Up/Down wrap, Enter picks, Escape closes, clicking an option keeps focus in the field
 *  - typing again clears the chosen investor; focusing again reopens the list while nothing is chosen
 *  - free text never counts as a choice
 * Changed: searches the investor list already loaded (investor.list) instead of a server call per
 * keystroke, so there is no delay; every typed word must match (same rule as the Investors page
 * filter); "No matching investor." is shown instead of closing; typing an exact Investor ID and
 * leaving the field picks that investor.
 *
 * Fires "investorchange" (bubbles) on the input when the chosen investor changes.
 */
(function () {
  "use strict";
  var MIN = 2, MAX = 20;
  var pop = document.createElement("div");
  pop.id = "investorPopup";
  pop.className = "isdpop pickpop";
  pop.setAttribute("role", "listbox");
  pop.hidden = true;
  document.body.appendChild(pop);
  var cur = null; // the picker whose list is open

  function name(p) { return (String(p.firstName || "") + " " + String(p.lastName || "")).trim(); }
  function label(p) { return name(p) + " (" + p.investorId + ")"; }
  function idOf(p) { return String(p.investorId || "").toUpperCase(); }

  function search(list, q) {
    var tokens = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (String(q || "").trim().length < MIN) return [];
    return list.filter(function (p) {
      var hay = [p.investorId, p.firstName, p.lastName, p.email].join(" ").toLowerCase();
      return tokens.every(function (t) { return hay.indexOf(t) !== -1; });
    }).slice(0, MAX);
  }

  function position() {
    if (!cur) return;
    var r = cur.input.getBoundingClientRect();
    var w = Math.min(Math.max(r.width, 300), window.innerWidth - 16);
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
      none.textContent = cur.loaded() ? "No matching investor." : "The investor list is still loading.";
      pop.appendChild(none);
      cur.input.removeAttribute("aria-activedescendant");
      return;
    }
    cur.matches.forEach(function (p, i) {
      var o = document.createElement("div");
      o.id = "invOpt" + i;
      o.className = "isdopt pickopt" + (i === cur.active ? " active" : "");
      o.setAttribute("role", "option");
      o.setAttribute("aria-selected", i === cur.active ? "true" : "false");
      var b = document.createElement("strong");
      b.textContent = p.investorId;
      var s = document.createElement("span");
      s.textContent = name(p) + (p.email ? " · " + p.email : "");
      o.appendChild(b); o.appendChild(s);
      o.addEventListener("mousedown", function (ev) { ev.preventDefault(); }); // keep focus in the input
      o.addEventListener("click", function () { pick(cur, p); });
      pop.appendChild(o);
    });
    if (cur.active >= 0) {
      cur.input.setAttribute("aria-activedescendant", "invOpt" + cur.active);
      var el = document.getElementById("invOpt" + cur.active);
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

  function fire(st) { st.input.dispatchEvent(new Event("investorchange", { bubbles: true })); }
  function pick(st, p) {
    st.investor = p;
    st.input.value = label(p);
    close();
    fire(st);
  }

  function attach(input, options) {
    var o = options || {};
    var st = {
      input: input, investor: null, matches: [], active: -1,
      source: function () { return (o.source && o.source()) || []; },
      loaded: function () { return o.loaded ? !!o.loaded() : true; }
    };
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", "investorPopup");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    if (!input.placeholder) input.placeholder = "Search by ID, name or email";

    input.addEventListener("input", function () {
      var had = !!st.investor;
      st.investor = null;
      if (had) fire(st);
      open(st);
    });
    input.addEventListener("focus", function () { if (!st.investor) open(st); });
    input.addEventListener("blur", function () {
      setTimeout(function () {
        if (document.activeElement === input) return;
        if (cur === st) close();
        if (!st.investor) {
          // An exact Investor ID typed in full counts as a choice; anything else stays unchosen.
          var typed = String(input.value).trim().toUpperCase(), list = st.source();
          for (var i = 0; i < list.length; i++) if (idOf(list[i]) === typed) { pick(st, list[i]); return; }
          fire(st); // lets the screen show "Investor is required."
        }
      }, 120);
    });
    input.addEventListener("keydown", function (ev) {
      var k = ev.key;
      if (k === "ArrowDown" || k === "ArrowUp") {
        if (!isOpen() || cur !== st) { if (!st.investor) open(st); if (!isOpen()) return; }
        ev.preventDefault();
        var n = st.matches.length;
        if (!n) return;
        st.active = k === "ArrowDown" ? (st.active + 1) % n : (st.active - 1 + n) % n;
        render();
      } else if (k === "Enter" && isOpen() && cur === st) {
        ev.preventDefault(); // never submit the form from this field
        if (st.active >= 0) pick(st, st.matches[st.active]);
        else if (st.matches.length === 1) pick(st, st.matches[0]);
      } else if (k === "Escape" && isOpen() && cur === st) {
        ev.preventDefault(); ev.stopPropagation();
        close();
      }
    });

    return {
      input: input,
      getId: function () { return st.investor ? st.investor.investorId : ""; },
      getInvestor: function () { return st.investor; },
      setId: function (id) {
        var want = String(id || "").toUpperCase(), list = st.source(), found = null;
        for (var i = 0; i < list.length; i++) if (idOf(list[i]) === want) { found = list[i]; break; }
        st.investor = found;
        input.value = found ? label(found) : "";
      },
      setError: function (msg) {
        input.classList.toggle("invalid", !!msg);
        if (msg) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
      },
      close: function () { if (cur === st) close(); }
    };
  }

  window.addEventListener("scroll", function (ev) {
    if (isOpen() && !(ev.target instanceof Node && pop.contains(ev.target))) close();
  }, true);
  window.addEventListener("resize", function () { if (isOpen()) close(); });
  window.InvestorPicker = { attach: attach, label: label };
})();
