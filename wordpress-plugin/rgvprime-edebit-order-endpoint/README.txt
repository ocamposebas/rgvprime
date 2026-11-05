RGVPRIME eDebit Order Endpoint

Version 1.2.2 validates shipping prices on the server, preserves the customer's
selected carrier/service for Pirate Ship, and activates free
standard shipping with no minimum through November 8, 2026 at 11:00 p.m.
America/Bogota. UPS 45 remains excluded. The normal $200 minimum resumes
automatically after the promotion.

New route: /wp-json/rgvprime/v1/create-edebit-order
Temporary compatible route: /wp-json/phase/v1/create-edebit-order
No wp-config.php secret is required in this transition build.
Deactivate and remove the previous Phase eDebit Order Endpoint before activation.
