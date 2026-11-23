(function () {
  "use strict";
  var COUNTRIES = String(window.COUNTRIES || "").split("\n").filter(Boolean).map(function (line) {
    var p = line.split("|");
    return { name: p[0], code: p[1], iso: p[2], alias: p[3] || "" };
  });
  var MAX = 12;
  var pop = document.createElement("div");
  pop.id = "isdPopup";
  pop.className = "isdpop";
  pop.setAttribute("role", "listbox");
  pop.hidden = true;
  document.body.appendChild(pop);
  var cur = null; // the field whose list is open

  function label(c) { return "(+" + c.code + ") " + c.name; }
  function byCode(code) {
    for (var i = 0; i < COUNTRIES.length; i++) if (COUNTRIES[i].code === String(code)) return COUNTRIES[i];
    return null;
  }

  // Matches name, code, ISO code or alias; matches at the start of a word come first.
  function search(q) {
    q = String(q || "").toLowerCase().replace(/[()+]/g, "").trim();
    if (!q) return COUNTRIES.slice(0, MAX);
    function starts(c) {
      return [c.name, c.code, c.iso].concat(c.alias.split(" ")).some(function (w) { return w.toLowerCase().indexOf(q) === 0; });
    }
    var hits = COUNTRIES.filter(function (c) {
      return (c.name + " " + c.code + " " + c.iso + " " + c.alias).toLowerCase().indexOf(q) !== -1;
    });
    hits.sort(function (a, b) { return (starts(a) ? 0 : 1) - (starts(b) ? 0 : 1); });
    return hits.slice(0, MAX);
  }

  function position() {
    if (!cur) return;
    var r = cur.input.getBoundingClientRect();
    var w = Math.min(Math.max(r.width, 260), window.innerWidth - 16);
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
      none.textContent = "No matching country or ISD code.";
      pop.appendChild(none);
      cur.input.removeAttribute("aria-activedescendant");
      return;
    }
    cur.matches.forEach(function (c, i) {
      var o = document.createElement("div");
      o.id = "isdOpt" + i;
      o.className = "isdopt" + (i === cur.active ? " active" : "");
      o.setAttribute("role", "option");
      o.setAttribute("aria-selected", i === cur.active ? "true" : "false");
      o.textContent = label(c);
      o.addEventListener("mousedown", function (ev) { ev.preventDefault(); }); // keep focus in the input
      o.addEventListener("click", function () { pick(cur, c); });
      pop.appendChild(o);
    });
    if (cur.active >= 0) {
      cur.input.setAttribute("aria-activedescendant", "isdOpt" + cur.active);
      var el = document.getElementById("isdOpt" + cur.active);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    } else cur.input.removeAttribute("aria-activedescendant");
  }

  function open(st, query) {
    if (cur && cur !== st) cur.input.setAttribute("aria-expanded", "false");
    cur = st;
    st.matches = search(query);
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

  function pick(st, c) {
    st.code = st.lastCode = c.code;
    st.lastLabel = label(c);
    st.input.value = st.lastLabel;
    close();
    st.input.dispatchEvent(new Event("isdchange", { bubbles: true }));
  }
  function revert(st) { st.code = st.lastCode; st.input.value = st.lastLabel; }

  // On leaving the field: a single obvious match is accepted, anything else goes back to the last valid choice.
  function commit(st) {
    if (!st.code) {
      var m = search(st.input.value);
      if (st.input.value.trim() && m.length === 1) { pick(st, m[0]); return; }
      revert(st);
    }
  }

  function attach(input) {
    var st = { input: input, code: "", lastCode: "", lastLabel: "", matches: [], active: -1 };
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", "isdPopup");
    input.setAttribute("autocomplete", "off");
    input.addEventListener("input", function () { st.code = ""; open(st, input.value); });
    input.addEventListener("focus", function () { input.select(); open(st, st.code ? "" : input.value); });
    input.addEventListener("blur", function () {
      setTimeout(function () { if (document.activeElement !== input) { commit(st); if (cur === st) close(); } }, 120);
    });
    input.addEventListener("keydown", function (ev) {
      var k = ev.key;
      if (k === "ArrowDown" || k === "ArrowUp") {
        ev.preventDefault();
        if (!isOpen() || cur !== st) { open(st, ""); return; }
        var n = st.matches.length;
        if (!n) return;
        st.active = k === "ArrowDown" ? (st.active + 1) % n : (st.active - 1 + n) % n;
        render();
      } else if (k === "Enter" && isOpen() && cur === st) {
        ev.preventDefault(); // never submit the form from the country field
        if (st.active >= 0) pick(st, st.matches[st.active]);
        else if (st.matches.length === 1) pick(st, st.matches[0]);
      } else if (k === "Escape" && isOpen() && cur === st) {
        ev.preventDefault(); ev.stopPropagation();
        revert(st); close();
      }
    });
    return {
      input: input,
      getCode: function () { return st.code; },
      setCode: function (code) {
        var c = code ? byCode(code) : null;
        st.code = st.lastCode = code ? String(code) : "";
        st.lastLabel = c ? label(c) : (code ? "(+" + code + ")" : "");
        input.value = st.lastLabel;
      }
    };
  }

  window.addEventListener("scroll", function (ev) { if (isOpen() && !pop.contains(ev.target)) close(); }, true);
  window.addEventListener("resize", function () { if (isOpen()) close(); });
  window.IsdField = { attach: attach };
})();
