<?php
declare(strict_types=1);

define( 'ABSPATH', __DIR__ );

final class WP_Error {
	public function __construct( public string $code = '', public string $message = '' ) {}
}

final class PSC_Test_Session {
	public array $values = array();
	public function get( string $key, $default = null ) { return $this->values[ $key ] ?? $default; }
	public function set( string $key, $value ): void { $this->values[ $key ] = $value; }
}

final class PSC_Test_Woo {
	public PSC_Test_Session $session;
	public function __construct() { $this->session = new PSC_Test_Session(); }
}

$GLOBALS['psc_test_woo'] = new PSC_Test_Woo();
function WC(): PSC_Test_Woo { return $GLOBALS['psc_test_woo']; }

function psc_assert( bool $condition, string $message ): void {
	if ( ! $condition ) { throw new RuntimeException( $message ); }
}

$plugin = dirname( __DIR__ ) . '/prism-simple-checkout';
$base = dirname( dirname( __DIR__ ) ) . '/audit-provider-original-0132/prism-simple-checkout';

require_once $plugin . '/includes/class-service-client.php';
require_once $plugin . '/includes/class-rest-routes.php';

// Forward-compatible response schema, while consumed optional fields stay typed.
$required = array( 'payment_id' => 'string', 'amount_minor' => 'int' );
$optional = array( 'client_secret' => 'nullable_string' );
$valid = array( 'payment_id' => 'pi_test', 'amount_minor' => 100, 'client_secret' => null, 'future_field' => array( 'safe' => true ) );
psc_assert( true === \PrismSimpleCheckout\Service_Client::validate_schema( $valid, $required, $optional ), 'Additive or nullable service response was rejected.' );
psc_assert( \PrismSimpleCheckout\Service_Client::validate_schema( array( 'payment_id' => 'pi_test', 'amount_minor' => 100, 'client_secret' => 7 ), $required, $optional ) instanceof WP_Error, 'Invalid optional field type was accepted.' );
psc_assert( \PrismSimpleCheckout\Service_Client::validate_schema( array( 'payment_id' => 'pi_test' ), $required, $optional ) instanceof WP_Error, 'Missing required field was accepted.' );

// Pending confirmation state is usable only by its own Woo order.
$reflection = new ReflectionClass( \PrismSimpleCheckout\Rest_Routes::class );
$matches = $reflection->getMethod( 'pending_matches_order' );
$matches->setAccessible( true );
$order_41 = new class() { public function get_id(): int { return 41; } };
psc_assert( true === $matches->invoke( null, array( 'order_id' => 41 ), $order_41 ), 'Same-order pending state did not match.' );
psc_assert( false === $matches->invoke( null, array( 'order_id' => 42 ), $order_41 ), 'Different-order pending state matched.' );
psc_assert( false === $matches->invoke( null, array( 'order_id' => 41 ), null ), 'Cart checkout inherited an order pending state.' );

WC()->session->set( 'psc_confirm_pending', array( 'order_id' => 41, 'attempt_id' => 'attempt-a', 'operation_id' => 'operation-a' ) );
psc_assert( false === \PrismSimpleCheckout\Rest_Routes::clear_matching_pending( 42, 'attempt-a', 'operation-a' ), 'Different order cleared pending state.' );
psc_assert( is_array( WC()->session->get( 'psc_confirm_pending' ) ), 'Different order mutated pending state.' );
psc_assert( false === \PrismSimpleCheckout\Rest_Routes::clear_matching_pending( 41, 'attempt-b', 'operation-a' ), 'Different attempt cleared pending state.' );
psc_assert( true === \PrismSimpleCheckout\Rest_Routes::clear_matching_pending( 41, 'attempt-a', 'operation-a' ), 'Exact identity did not clear pending state.' );
psc_assert( null === WC()->session->get( 'psc_confirm_pending' ), 'Exact identity left pending state behind.' );

$rest = file_get_contents( $plugin . '/includes/class-rest-routes.php' );
$completion = file_get_contents( $plugin . '/includes/class-completion.php' );
$gateway = file_get_contents( $plugin . '/includes/class-gateway.php' );
$service = file_get_contents( $plugin . '/includes/class-service-client.php' );
$reconciler = file_get_contents( $plugin . '/includes/class-reconciler.php' );
$main = file_get_contents( $plugin . '/prism-simple-checkout.php' );

psc_assert( str_contains( $rest, "'succeeded' === \$status" ) && str_contains( $rest, 'accept_progress( $order, $payment, $guard )' ) && str_contains( $rest, 'finish_unpaid( $order, $identity, $payment )' ), 'Callback status dispatcher is incomplete.' );
psc_assert( str_contains( $completion, "array( 'creating', 'requires_action', 'processing', 'attention' )" ), 'Progress states are not explicitly bounded.' );
psc_assert( str_contains( $completion, "array( 'failed', 'canceled' )" ), 'Terminal unpaid states are not explicitly bounded.' );
psc_assert( str_contains( $completion, "set_status( 'on-hold' )" ) && str_contains( $completion, 'META_STATUS' ), 'Async processing is not persisted/on-hold.' );
psc_assert( ! str_contains( $gateway, "session->set( 'psc_confirm_pending', null )" ), 'Gateway still clears another order\'s singleton pending state.' );
psc_assert( substr_count( $service, "'client_secret' => 'nullable_string'" ) >= 2 && ! str_contains( $service, 'array_diff_key( $data, $allowed )' ), 'Service schema compatibility patch is incomplete.' );
psc_assert( str_contains( $rest, "\$create_payload['woo_order_id']" ) && str_contains( $rest, "\$create_payload['woo_order_key']" ), 'Order-pay attempt is not bound to its Woo order.' );
psc_assert( str_contains( $reconciler, "'wc-pending', 'wc-on-hold'" ) && str_contains( $reconciler, 'ASYNC_HOLD_WINDOW = 604800' ) && str_contains( $reconciler, 'ASYNC_MAX_ATTEMPTS = 2016' ), 'Seven-day async reconciliation is incomplete.' );
psc_assert( str_contains( $main, 'Version:           0.1.3.4' ) && str_contains( $main, "define( 'PSC_VERSION', '0.1.3.4' )" ), 'Plugin version was not bumped consistently.' );

// Ensure the patch did not touch UI assets or unrelated provider files.
$allowed_changes = array(
	'includes/class-completion.php',
	'includes/class-gateway.php',
	'includes/class-reconciler.php',
	'includes/class-rest-routes.php',
	'includes/class-service-client.php',
	'prism-simple-checkout.php',
);
$iterator = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $plugin, FilesystemIterator::SKIP_DOTS ) );
$changed = array();
foreach ( $iterator as $file ) {
	if ( ! $file->isFile() ) { continue; }
	$relative = str_replace( '\\', '/', substr( $file->getPathname(), strlen( $plugin ) + 1 ) );
	$original = $base . '/' . $relative;
	if ( ! is_file( $original ) || hash_file( 'sha256', $file->getPathname() ) !== hash_file( 'sha256', $original ) ) { $changed[] = $relative; }
}
sort( $changed );
sort( $allowed_changes );
psc_assert( $changed === $allowed_changes, 'Unexpected plugin files changed: ' . implode( ', ', $changed ) );

echo "provider patch static tests: OK\n";
