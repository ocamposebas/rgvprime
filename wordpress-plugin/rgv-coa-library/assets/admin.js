(function ($) {
  "use strict";

  function updatePlacement() {
    $(".rgv-coa-placement label").each(function () {
      $(this).toggleClass("is-selected", $(this).find("input").is(":checked"));
    });
  }

  $(document).on("change", ".rgv-coa-placement input", updatePlacement);

  $(document).on("click", "[data-rgv-choose]", function (event) {
    event.preventDefault();
    var $upload = $(this).closest("[data-rgv-upload]");
    var frame = wp.media({
      title: rgvCoaAdmin.mediaTitle,
      button: { text: rgvCoaAdmin.mediaButton },
      library: { type: "application/pdf" },
      multiple: false,
    });

    frame.on("select", function () {
      var file = frame.state().get("selection").first().toJSON();
      $upload.addClass("has-file");
      $upload.find("[data-rgv-attachment]").val(file.id);
      $upload.find("[data-rgv-file-name]").text(file.filename || file.title);
      $upload.find("[data-rgv-choose]").text("Replace PDF");
      $upload.find("[data-rgv-remove]").prop("hidden", false);
    });

    frame.open();
  });

  $(document).on("click", "[data-rgv-remove]", function (event) {
    event.preventDefault();
    var $upload = $(this).closest("[data-rgv-upload]");
    $upload.removeClass("has-file");
    $upload.find("[data-rgv-attachment]").val("");
    $upload.find("[data-rgv-file-name]").text("No PDF selected");
    $upload.find("[data-rgv-choose]").text("Choose PDF");
    $(this).prop("hidden", true);
  });

  $(document).on("click", "[data-rgv-delete]", function (event) {
    if (!window.confirm("Move this certificate to Trash?")) {
      event.preventDefault();
    }
  });

  $(function () {
    updatePlacement();
    $(document.body).trigger("wc-enhanced-select-init");
  });
})(jQuery);

