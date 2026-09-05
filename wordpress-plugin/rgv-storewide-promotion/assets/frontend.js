(function () {
  "use strict";

  function pad(value) {
    return String(Math.max(0, value)).padStart(2, "0");
  }

  document.querySelectorAll("[data-rgv-promotion]").forEach(function (banner) {
    if (document.body.firstElementChild !== banner) {
      document.body.prepend(banner);
    }

    var endsAt = Date.parse(banner.dataset.endsAt || "");
    var serverTime = Date.parse(banner.dataset.serverTime || "");
    var clockOffset = Number.isFinite(serverTime) ? serverTime - Date.now() : 0;

    if (!Number.isFinite(endsAt)) return;

    var fields = {
      days: banner.querySelector("[data-rgv-days]"),
      hours: banner.querySelector("[data-rgv-hours]"),
      minutes: banner.querySelector("[data-rgv-minutes]"),
      seconds: banner.querySelector("[data-rgv-seconds]"),
    };

    function update() {
      var remaining = Math.max(0, Math.floor((endsAt - (Date.now() + clockOffset)) / 1000));
      var days = Math.floor(remaining / 86400);
      var hours = Math.floor((remaining % 86400) / 3600);
      var minutes = Math.floor((remaining % 3600) / 60);
      var seconds = remaining % 60;

      if (fields.days) fields.days.textContent = pad(days);
      if (fields.hours) fields.hours.textContent = pad(hours);
      if (fields.minutes) fields.minutes.textContent = pad(minutes);
      if (fields.seconds) fields.seconds.textContent = pad(seconds);

      if (remaining <= 0) {
        banner.remove();
        return false;
      }

      return true;
    }

    update();
    var timer = window.setInterval(function () {
      if (!update()) window.clearInterval(timer);
    }, 1000);
  });
}());
