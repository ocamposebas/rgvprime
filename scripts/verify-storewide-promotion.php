<?php
declare(strict_types=1);

define( 'ABSPATH', __DIR__ );

$GLOBALS['rgv_products'] = array();
$GLOBALS['rgv_promotion_settings'] = array(
	'enabled'          => true,
	'scope'            => 'product',
	'product_id'       => 101,
	'discount_percent' => 20.0,
	'starts_at'        => time() - 60,
	'ends_at'          => time() + 3600,
	'eyebrow'          => 'LIMITED-TIME OFFER',
	'headline'         => '20% OFF TARGET PRODUCT',
	'cta_label'        => 'SHOP NOW',
	'cta_url'          => '',
	'show_native'      => true,
);

function get_option( $key, $default = false ) {
	return 'rgv_storewide_promotion' === $key ? $GLOBALS['rgv_promotion_settings'] : $default;
}
function wp_parse_args( $args, $defaults ) { return array_merge( $defaults, $args ); }
function absint( $value ) { return abs( (int) $value ); }
function wc_get_product( $id ) { return $GLOBALS['rgv_products'][ (int) $id ] ?? false; }
function is_admin() { return false; }
function wp_doing_ajax() { return false; }
function wc_get_price_decimals() { return 2; }
function wc_format_decimal( $value, $decimals = 2 ) { return number_format( (float) $value, (int) $decimals, '.', '' ); }

class WC_Product {
	private int $id;
	private int $parent_id;
	private string $type;
	private string $name;

	public function __construct( int $id, string $name, string $type = 'simple', int $parent_id = 0 ) {
		$this->id        = $id;
		$this->name      = $name;
		$this->type      = $type;
		$this->parent_id = $parent_id;
	}

	public function get_id() { return $this->id; }
	public function get_parent_id() { return $this->parent_id; }
	public function get_name() { return $this->name; }
	public function get_permalink() { return 'https://example.test/product/' . $this->id; }
	public function get_regular_price( $context = 'view' ) { return '100.00'; }
	public function is_type( $type ) { return $this->type === $type; }
}

function expect_same( $expected, $actual, string $message ): void {
	if ( $expected !== $actual ) {
		throw new RuntimeException( $message . ' Expected ' . var_export( $expected, true ) . ', received ' . var_export( $actual, true ) . '.' );
	}
}

$target    = new WC_Product( 101, 'Target Product' );
$variation = new WC_Product( 102, 'Target Product - 60mg', 'variation', 101 );
$other     = new WC_Product( 201, 'Other Product' );

$GLOBALS['rgv_products'] = array(
	101 => $target,
	102 => $variation,
	201 => $other,
);

require __DIR__ . '/../wordpress-plugin/rgv-storewide-promotion/includes/class-rgv-storewide-promotion.php';

expect_same( 'active', RGV_Storewide_Promotion::campaign_status(), 'The configured product campaign must be active.' );
expect_same( '80.00', RGV_Storewide_Promotion::discount_product_price( '100.00', $target ), 'The selected product must receive the discount.' );
expect_same( '96.00', RGV_Storewide_Promotion::discount_product_price( '120.00', $variation ), 'Every variation of the selected product must receive the discount.' );
expect_same( '100.00', RGV_Storewide_Promotion::discount_product_price( '100.00', $other ), 'Unselected products must keep their original price.' );
expect_same( true, RGV_Storewide_Promotion::mark_product_on_sale( false, $target ), 'The selected product must be marked on sale.' );
expect_same( false, RGV_Storewide_Promotion::mark_product_on_sale( false, $other ), 'An unselected product must not be marked on sale.' );

$cta_method = new ReflectionMethod( RGV_Storewide_Promotion::class, 'campaign_cta_url' );
$cta_method->setAccessible( true );
expect_same( 'https://example.test/product/101', $cta_method->invoke( null ), 'The banner must link to the selected product when no custom URL is set.' );

$settings_property = new ReflectionProperty( RGV_Storewide_Promotion::class, 'settings' );
$settings_property->setAccessible( true );
$settings_property->setValue(
	null,
	array_merge(
		$GLOBALS['rgv_promotion_settings'],
		array(
			'scope'            => 'announcement',
			'product_id'       => 0,
			'discount_percent' => 0.0,
			'ends_at'          => 0,
			'cta_label'        => '',
			'cta_url'          => '',
			'show_countdown'   => false,
		)
	)
);

expect_same( 'active', RGV_Storewide_Promotion::campaign_status(), 'An announcement without an end date must remain active until disabled.' );
expect_same( '100.00', RGV_Storewide_Promotion::discount_product_price( '100.00', $target ), 'An information-only announcement must not change product prices.' );
expect_same( '', $cta_method->invoke( null ), 'An information-only announcement may be published without a button.' );

echo "Promotion pricing verification passed (informational message, target product, variations, unrelated products and automatic banner link).\n";
