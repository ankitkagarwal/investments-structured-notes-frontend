(function () {
  "use strict";
  // Start Date limited to a Final Fixing Date of 15/10/2027, like a real note.
  var d1 = DateField.attach(document.getElementById("d1"), { label: "Start Date", required: true, max: "15/10/2027", maxLabel: "the Final Fixing Date" });
  var d2 = DateField.attach(document.getElementById("d2"), { label: "Date" });
  document.addEventListener("datechange", function (ev) {
    var h = ev.target.id === "d1" ? d1 : d2, msg = h.check();
    h.setError(msg);
    document.getElementById("out").textContent = ev.target.id + ": \"" + h.getValue() + "\" " + (msg || "OK");
  });
})();
