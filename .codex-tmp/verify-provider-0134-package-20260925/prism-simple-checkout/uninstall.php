<?php
/** Decommission-first uninstall; refusal or network ambiguity preserves every local byte. */
defined( 'WP_UNINSTALL_PLUGIN' ) || exit;
// Fall research evidence must not decommission a payment site or erase records.
wp_die( esc_html__( 'Deactivate PRISM Fall Checkout to stop it. Research records and credentials are retained; removal requires the Fall operator cleanup procedure.', 'prism-simple-checkout' ) );
defined( 'PSC_PAYMENT_CONTRACT' ) || define( 'PSC_PAYMENT_CONTRACT', 'psc-payment-1' );
defined( 'PSC_GATEWAY_ID' ) || define( 'PSC_GATEWAY_ID', 'psc' );
foreach ( array( 'credential-store', 'service-client', 'checkout-claim', 'updater', 'lifecycle' ) as $psc_inc ) {
	require_once __DIR__ . '/includes/class-' . $psc_inc . '.php';
}
\PrismSimpleCheckout\Lifecycle::uninstall() || wp_die( esc_html__( 'PRISM Simple Checkout could not confirm service decommission; all PRISM data was preserved. Retry uninstall after the service confirms.', 'prism-simple-checkout' ) );
