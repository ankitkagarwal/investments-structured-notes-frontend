/*
 * datefield.js: dd/mm/yyyy date field with a calendar popup (desktop) and the native
 * date picker (phones, max-width 620px). Same pattern as isd.js: one shared popup,
 * DateField.attach(input, options) returns a small handle.
 *
 * Behaviour matches the legacy Index.html date control:
 *  - text is kept exactly as typed while editing; on leaving, exactly 8 digits become dd/mm/yyyy
 *  - calendar: Monday first, << < > >> for year and month, Today and Clear, today and the
 *    selected day marked, opens on the current value (or today), the button toggles it,
 *    closes on outside click, scroll or resize
 * Added: an optional latest allowed date (max), keyboard use of the calendar, Escape.
 *
 * Fires "datechange" (bubbles) on the text input whenever the value is set by the
 * calendar, the phone picker or leaving the field.
 */
(function () {
  "use strict";
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  var DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  var DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function day0(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function today() { return day0(new Date()); }
  function same(a, b) { return !!a && !!b && a.getTime() === b.getTime(); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function addMonths(d, n) {
    // Keep the day where possible (31 Jan + 1 month = 28/29 Feb).
    var last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
    return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last));
  }

  function fmt(d) { return d ? pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear() : ""; }
  function iso(d) { return d ? d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) : ""; }
  function real(y, m, d) {
    var x = new Date(y, m - 1, d);
    return x.getFullYear() === y && x.getMonth() === m - 1 && x.getDate() === d ? x : null;
  }
  // Strict dd/mm/yyyy (the server also accepts yyyy-mm-dd; the UI always sends dd/mm/yyyy).
  function parse(text) {
    if (text instanceof Date) return isNaN(text) ? null : day0(text);
    var m = String(text == null ? "" : text).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? real(+m[3], +m[2], +m[1]) : null;
  }
  function fromIso(v) {
    var m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? real(+m[1], +m[2], +m[3]) : null;
  }
  // Leaving the field: exactly 8 digits become dd/mm/yyyy, anything else stays as typed.
  function tidy(text) {
    var v = String(text == null ? "" : text).trim();
    return /^\d{8}$/.test(v) ? v.slice(0, 2) + "/" + v.slice(2, 4) + "/" + v.slice(4) : v;
  }

  /** Returns "" when fine, otherwise a message. o = {label, required, max, maxLabel}. */
  function check(text, o) {
    o = o || {};
    var label = o.label || "Date", v = String(text == null ? "" : text).trim();
    if (!v) return o.required ? label + " is required." : "";
    var d = parse(v);
    if (!d) return label + " must be a valid date in dd/mm/yyyy format.";
    var max = parse(o.max);
    if (max && d > max) return label + " cannot be after " + (o.maxLabel || "") + " (" + fmt(max) + ").";
    return "";
  }

  // ---- shared popup ----
  var pop = document.createElement("div");
  pop.id = "datePopup";
  pop.className = "calpop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Choose date");
  pop.hidden = true;
  document.body.appendChild(pop);
  var cur = null; // { st, view (1st of shown month), focus (day with keyboard focus) }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function btn(cls, text, title, fn) {
    var b = el("button", cls, text);
    b.type = "button";
    if (title) { b.title = title; b.setAttribute("aria-label", title); }
    b.addEventListener("click", fn);
    return b;
  }
  function allowed(st, d) { var max = parse(st.max); return !max || d <= max; }

  function render(focusDay) {
    var st = cur.st, view = cur.view, sel = parse(st.input.value), now = today();
    while (pop.firstChild) pop.removeChild(pop.firstChild);

    var head = el("div", "calhead");
    head.appendChild(btn("calnav", "«", "Previous year", function () { shift(-12); }));
    head.appendChild(btn("calnav", "‹", "Previous month", function () { shift(-1); }));
    var title = el("span", "caltitle", MONTHS[view.getMonth()] + " " + view.getFullYear());
    title.setAttribute("aria-live", "polite");
    head.appendChild(title);
    head.appendChild(btn("calnav", "›", "Next month", function () { shift(1); }));
    head.appendChild(btn("calnav", "»", "Next year", function () { shift(12); }));
    pop.appendChild(head);

    var grid = el("div", "calgrid");
    DOW.forEach(function (d) { var h = el("div", "caldow", d); h.setAttribute("aria-hidden", "true"); grid.appendChild(h); });
    var offset = (view.getDay() + 6) % 7; // Monday first
    for (var i = 0; i < offset; i++) grid.appendChild(el("div"));
    var days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    var focusBtn = null;
    for (var n = 1; n <= days; n++) {
      (function (d) {
        var ok = allowed(st, d);
        var b = el("button", "calday" + (same(d, sel) ? " selected" : "") + (same(d, now) ? " today" : "") + (ok ? "" : " off"), String(d.getDate()));
        b.type = "button";
        b.tabIndex = same(d, cur.focus) ? 0 : -1;
        b.setAttribute("data-day", iso(d));
        b.setAttribute("aria-label", DOW_LONG[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear() +
          (ok ? "" : ", not allowed"));
        if (same(d, sel)) b.setAttribute("aria-pressed", "true");
        if (same(d, now)) b.setAttribute("aria-current", "date");
        if (!ok) b.setAttribute("aria-disabled", "true");
        b.addEventListener("click", function () { if (allowed(st, d)) pick(st, d); });
        if (same(d, cur.focus)) focusBtn = b;
        grid.appendChild(b);
      })(new Date(view.getFullYear(), view.getMonth(), n));
    }
    pop.appendChild(grid);

    var foot = el("div", "calfoot");
    var t = btn("", "Today", "", function () { if (allowed(st, today())) pick(st, today()); });
    if (!allowed(st, now)) { t.disabled = true; t.title = "Today is after the latest allowed date"; }
    foot.appendChild(t);
    foot.appendChild(btn("", "Clear", "", function () { pick(st, null); }));
    pop.appendChild(foot);

    position();
    if (focusDay && focusBtn) focusBtn.focus();
  }

  function position() {
    if (!cur) return;
    var r = cur.st.wrap.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    var left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    var top = r.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }

  function shift(months) {
    cur.view = new Date(cur.view.getFullYear(), cur.view.getMonth() + months, 1);
    cur.focus = addMonths(cur.focus, months);
    render(false);
  }
  function moveFocus(d) {
    cur.focus = d;
    if (d.getMonth() !== cur.view.getMonth() || d.getFullYear() !== cur.view.getFullYear()) {
      cur.view = new Date(d.getFullYear(), d.getMonth(), 1);
    }
    render(true);
  }

  function open(st, focusDay) {
    if (cur && cur.st !== st) close(false);
    var sel = parse(st.input.value), max = parse(st.max), start = sel || today();
    if (!sel && max && start > max) start = max; // nothing chosen and today not allowed: open on the latest month
    cur = { st: st, view: new Date(start.getFullYear(), start.getMonth(), 1), focus: start };
    pop.hidden = false;
    st.button.setAttribute("aria-expanded", "true");
    render(focusDay);
  }
  function close(returnFocus) {
    if (!cur) return;
    var st = cur.st;
    pop.hidden = true;
    st.button.setAttribute("aria-expanded", "false");
    cur = null;
    if (returnFocus) st.button.focus();
  }
  function isOpenFor(st) { return !!cur && cur.st === st && !pop.hidden; }

  function fire(st) { st.input.dispatchEvent(new Event("datechange", { bubbles: true })); }
  function syncNative(st) { st.native.value = iso(parse(st.input.value)); }
  function pick(st, d) {
    st.input.value = fmt(d);
    syncNative(st);
    close(false);
    st.input.focus();
    fire(st);
  }

  pop.addEventListener("keydown", function (ev) {
    if (!cur) return;
    var k = ev.key;
    if (k === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(true); return; }
    if (!ev.target.classList.contains("calday")) return;
    var f = cur.focus, next = null;
    if (k === "ArrowLeft") next = addDays(f, -1);
    else if (k === "ArrowRight") next = addDays(f, 1);
    else if (k === "ArrowUp") next = addDays(f, -7);
    else if (k === "ArrowDown") next = addDays(f, 7);
    else if (k === "Home") next = addDays(f, -((f.getDay() + 6) % 7));
    else if (k === "End") next = addDays(f, 6 - ((f.getDay() + 6) % 7));
    else if (k === "PageUp") next = addMonths(f, ev.shiftKey ? -12 : -1);
    else if (k === "PageDown") next = addMonths(f, ev.shiftKey ? 12 : 1);
    if (next) { ev.preventDefault(); moveFocus(next); }
  });
  // Clicking a day or nav button keeps keyboard focus in sync with what was clicked.
  pop.addEventListener("focusin", function (ev) {
    var v = ev.target.getAttribute && ev.target.getAttribute("data-day");
    if (cur && v) cur.focus = fromIso(v);
  });
  document.addEventListener("mousedown", function (ev) {
    if (cur && !pop.contains(ev.target) && !cur.st.wrap.contains(ev.target)) close(false);
  }, true);
  document.addEventListener("focusin", function (ev) {
    if (cur && !pop.contains(ev.target) && !cur.st.wrap.contains(ev.target)) close(false);
  });
  window.addEventListener("scroll", function (ev) {
    if (cur && !(ev.target instanceof Node && pop.contains(ev.target))) close(false);
  }, true);
  window.addEventListener("resize", function () { if (cur) close(false); });

  function calendarIcon() {
    var NS = "http://www.w3.org/2000/svg", s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", "18"); s.setAttribute("height", "18");
    s.setAttribute("aria-hidden", "true"); s.setAttribute("focusable", "false");
    [["rect", { x: "3.5", y: "5", width: "17", height: "15", rx: "2" }],
     ["path", { d: "M3.5 10h17M8 3v4M16 3v4" }]].forEach(function (p) {
      var e = document.createElementNS(NS, p[0]);
      Object.keys(p[1]).forEach(function (a) { e.setAttribute(a, p[1][a]); });
      e.setAttribute("fill", "none"); e.setAttribute("stroke", "currentColor");
      e.setAttribute("stroke-width", "1.6"); e.setAttribute("stroke-linecap", "round");
      s.appendChild(e);
    });
    return s;
  }

  /** options = {label, required, max (Date or dd/mm/yyyy), maxLabel} */
  function attach(input, options) {
    var o = options || {};
    var st = { input: input, max: o.max || null, wrap: el("div", "datefield"), button: null, native: null };
    var label = o.label || "date";

    input.type = "text";
    input.classList.add("dftext");
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("maxlength", "10");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    if (!input.placeholder) input.placeholder = "dd/mm/yyyy";

    st.button = btn("calbtn", null, "Choose " + label, function () {
      if (isOpenFor(st)) close(true); else open(st, true);
    });
    st.button.appendChild(calendarIcon());
    st.button.setAttribute("aria-haspopup", "dialog");
    st.button.setAttribute("aria-expanded", "false");
    st.button.setAttribute("aria-controls", "datePopup");

    st.native = el("input", "mobiledate");
    st.native.type = "date";
    st.native.setAttribute("aria-label", label);

    input.parentNode.insertBefore(st.wrap, input);
    st.wrap.appendChild(input);
    st.wrap.appendChild(st.button);
    st.wrap.appendChild(st.native);

    input.addEventListener("input", function () { syncNative(st); });
    input.addEventListener("blur", function () {
      var v = tidy(input.value);
      if (v !== input.value) input.value = v;
      syncNative(st);
      fire(st);
    });
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowDown" && ev.altKey) { ev.preventDefault(); open(st, true); }
    });
    st.native.addEventListener("change", function () {
      input.value = fmt(fromIso(st.native.value));
      fire(st);
    });

    var handle = {
      input: input,
      getValue: function () { return tidy(input.value); },
      getDate: function () { return parse(input.value); },
      setValue: function (v) { input.value = v instanceof Date ? fmt(v) : tidy(v); syncNative(st); },
      setMax: function (max, maxLabel) {
        st.max = max || null;
        if (maxLabel !== undefined) o.maxLabel = maxLabel;
        st.native.max = iso(parse(st.max));
        if (isOpenFor(st)) render(false);
      },
      check: function () {
        return check(input.value, { label: o.label, required: o.required, max: st.max, maxLabel: o.maxLabel });
      },
      setError: function (msg) {
        [input, st.native].forEach(function (e) {
          e.classList.toggle("invalid", !!msg);
          if (msg) e.setAttribute("aria-invalid", "true"); else e.removeAttribute("aria-invalid");
        });
      },
      close: function () { if (isOpenFor(st)) close(false); }
    };
    handle.setMax(st.max, o.maxLabel);
    return handle;
  }

  window.DateField = { attach: attach, parse: parse, format: fmt, check: check };
})();
