document.addEventListener('DOMContentLoaded', function () {


  // Resilient WooCommerce customer import. Each request handles a small order batch
  // so large stores cannot exhaust PHP memory/time in one admin request.
  const wcImportForm = document.getElementById('rgvne-wc-import-form');
  const wcImportButton = document.getElementById('rgvne-wc-import-button');
  const wcImportConfirm = document.getElementById('rgvne-wc-import-confirm');
  const wcImportProgress = document.getElementById('rgvne-wc-import-progress');
  const wcImportStatus = document.getElementById('rgvne-wc-import-status');
  const wcImportMeta = document.getElementById('rgvne-wc-import-meta');
  const wcImportBar = document.getElementById('rgvne-wc-import-bar');

  if (wcImportForm && window.RGVNE_WC_IMPORT) {
    wcImportForm.addEventListener('submit', async function (event) {
      event.preventDefault();

      if (!wcImportConfirm || !wcImportConfirm.checked) {
        if (wcImportConfirm) wcImportConfirm.reportValidity();
        return;
      }

      if (wcImportButton) wcImportButton.disabled = true;
      if (wcImportProgress) wcImportProgress.style.display = 'block';
      if (wcImportStatus) wcImportStatus.textContent = 'Starting WooCommerce customer import…';
      if (wcImportMeta) wcImportMeta.textContent = 'Reading paid orders in safe batches.';
      if (wcImportBar) wcImportBar.style.width = '4%';

      let page = 1;
      let first = true;

      try {
        while (true) {
          const body = new URLSearchParams();
          body.set('action', 'rgvne_import_wc_customers_batch');
          body.set('nonce', RGVNE_WC_IMPORT.nonce);
          body.set('page', String(page));
          if (first) body.set('start', '1');

          const response = await fetch(RGVNE_WC_IMPORT.ajaxUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: body.toString()
          });

          let payload;
          try {
            payload = await response.json();
          } catch (parseError) {
            throw new Error('WordPress returned an invalid response while importing. Check the WooCommerce/PHP error log.');
          }

          if (!response.ok || !payload || !payload.success) {
            const message = payload && payload.data && payload.data.message
              ? payload.data.message
              : 'This import batch could not be completed.';
            throw new Error(message);
          }

          const data = payload.data || {};
          const progress = Number.isFinite(Number(data.progress)) ? Number(data.progress) : 0;
          if (wcImportBar) wcImportBar.style.width = Math.max(4, Math.min(100, progress)) + '%';
          if (wcImportStatus) {
            wcImportStatus.textContent = data.done
              ? 'WooCommerce import complete.'
              : 'Importing WooCommerce customers… ' + progress + '%';
          }
          if (wcImportMeta) {
            wcImportMeta.textContent =
              (data.processed || 0) + ' paid orders checked · ' +
              (data.imported || 0) + ' unique customers imported/updated · ' +
              (data.skipped || 0) + ' skipped';
          }

          if (data.done) break;
          page = parseInt(data.nextPage, 10) || (page + 1);
          first = false;
        }
      } catch (error) {
        if (wcImportStatus) wcImportStatus.textContent = 'Import stopped safely.';
        if (wcImportMeta) wcImportMeta.textContent = error && error.message ? error.message : 'Unknown import error.';
        if (wcImportBar) wcImportBar.style.width = '100%';
      } finally {
        if (wcImportButton) wcImportButton.disabled = false;
      }
    });
  }

  const campaignForm = document.querySelector('.rgvne-editor-form');
  if (!campaignForm) return;

  campaignForm.addEventListener('submit', function (event) {
    const submitter = event.submitter;
    if (submitter && submitter.value === 'launch') {
      if (!window.confirm('Queue this campaign for all active subscribers?')) {
        event.preventDefault();
      }
    }
  });

  const previewFrame = document.getElementById('rgvne-live-preview');
  const previewStage = document.querySelector('.rgvne-preview-stage');
  const loading = document.querySelector('.rgvne-preview-loading');
  const sizeButtons = document.querySelectorAll('[data-rgvne-preview-size]');
  let timer = null;
  let requestController = null;

  if (!previewFrame || !window.RGVNE_PREVIEW) return;

  function setLoading(isLoading) {
    if (!loading) return;
    loading.hidden = !isLoading;
    if (previewStage) previewStage.classList.toggle('is-loading', isLoading);
  }

  async function updatePreview() {
    if (requestController) requestController.abort();
    requestController = new AbortController();

    const data = new FormData(campaignForm);

    // The editor form also contains normal admin actions. admin-ajax.php runs
    // admin_init, so never send those action fields with a preview request.
    data.delete('rgvne_action');
    data.delete('rgvne_nonce');
    data.delete('rgvne_secondary_action');
    data.delete('test_email');
    data.delete('confirm_send');
    data.set('action', 'rgvne_live_preview');
    data.set('nonce', RGVNE_PREVIEW.nonce);

    setLoading(true);

    try {
      const response = await fetch(RGVNE_PREVIEW.ajaxUrl, {
        method: 'POST',
        credentials: 'same-origin',
        body: data,
        signal: requestController.signal
      });
      const payload = await response.json();
      if (!payload || !payload.success || !payload.data || !payload.data.html) {
        const serverMessage = payload && payload.data && payload.data.message ? payload.data.message : 'Preview could not be generated.';
        throw new Error(serverMessage);
      }
      previewFrame.srcdoc = payload.data.html;
    } catch (error) {
      if (error.name !== 'AbortError') {
        const message = String(error && error.message ? error.message : 'Preview could not be generated.');
        previewFrame.srcdoc = '<!doctype html><html><body style="font-family:Arial,sans-serif;padding:24px;color:#7a1a1a;background:#fff"><strong>Preview unavailable.</strong><br><br>' + message.replace(/[&<>"']/g, function (char) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[char]; }) + '</body></html>';
      }
    } finally {
      setLoading(false);
    }
  }

  function schedulePreview() {
    window.clearTimeout(timer);
    timer = window.setTimeout(updatePreview, 320);
  }

  campaignForm.addEventListener('input', function (event) {
    if (event.target.matches('input[name="test_email"], input[name="confirm_send"]')) return;
    schedulePreview();
  });
  campaignForm.addEventListener('change', function (event) {
    if (event.target.matches('input[name="test_email"], input[name="confirm_send"]')) return;
    schedulePreview();
  });

  sizeButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      sizeButtons.forEach(function (item) { item.classList.remove('is-active'); });
      button.classList.add('is-active');
      const mobile = button.dataset.rgvnePreviewSize === 'mobile';
      previewFrame.classList.toggle('is-mobile', mobile);
    });
  });

  updatePreview();
});
