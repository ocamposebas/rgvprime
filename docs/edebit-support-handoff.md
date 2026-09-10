# eDebit / Yodlee support handoff

## Request to eDebit Direct

Subject: RGVPRIME — Yodlee loop investigation and fallback validation

Hi Jeff,

We updated our checkout to distinguish abandoned bank-linking sessions from confirmed payments. eDebit is no longer preselected, customers receive an explicit confirmation before entering the hosted flow, matching pending attempts are reused, and unpaid WooCommerce orders expire after 60 minutes.

Please investigate the actual Yodlee loops separately from normal abandonment and provide:

1. Timestamps, eDebit session/transaction identifiers, browser/device, and institution for each observed loop.
2. The expected server callback or webhook sequence and the WooCommerce status expected at every stage.
3. Confirmation that an opened or abandoned FastLink session is not counted as a submitted transaction.
4. Confirmation that every hosted return includes both the WooCommerce `order_id` and `order_key`.
5. Whether Plaid or DataX can be enabled as a fallback for this merchant when Yodlee cannot complete bank linking.

Please do not change production code, plugins, callback URLs, gateway credentials, or WooCommerce statuses without written approval. If access is needed, identify the exact screens and logs required first.

## Temporary-access checklist

- Verify the request through the existing eDebit support phone number or an already established support thread.
- Take a WordPress/database backup before access is created.
- Prefer a staging clone with sanitized customer data.
- If production access is unavoidable, create a new temporary WordPress administrator for the verified `@edebitdirect.com` address; never share an existing administrator password.
- Do not provide hosting, database, SSH, payment API, or environment-secret access unless the investigation proves it is necessary and it is approved separately.
- Ask the engineer to record every setting or file changed.
- Revoke the temporary account and rotate any secret that was exposed when the investigation ends.

## Reproduction matrix

For each test, record time, order number, institution, browser, device, final WooCommerce status, and whether the eDebit dashboard created a transaction.

- Chrome desktop, normal and incognito.
- Safari iPhone, normal and private browsing.
- One successful bank-linking flow.
- User closes Yodlee before choosing a bank.
- User cancels after choosing a bank but before authorization.
- User returns with Back and resumes the same attempt.
- User replaces an incomplete attempt.
- Yodlee failure followed by Zelle selection.

Expected result: only a server-confirmed WooCommerce payment is treated as completed. Opened, cancelled, failed, and expired flows remain unconfirmed and never clear the cart.

