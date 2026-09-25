<?php
namespace PrismSimpleCheckout;
defined( 'ABSPATH' ) || exit;
/** Canonical digest of every Woo input that can change payment amount or delivery. */
final class Cart_Fingerprint {
	private const EXTENSION_SESSION = 'psc_extension_fields';
	private const ADDRESS_FIELDS = array( 'first_name', 'last_name', 'company', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country', 'phone' );
	public static function from_cart(): string {
		return hash( 'sha256', (string) wp_json_encode( self::canonicalize( self::payload_from_cart() ) ) );
	}

	/** Authoritative Woo cart total in Stripe minor units. */
	public static function amount_minor_from_cart(): int {
		$cart = function_exists( 'WC' ) && WC() ? WC()->cart : null;
		if ( ! $cart ) {
			return 0;
		}
		$currency = strtolower( (string) get_woocommerce_currency() );
		return self::total_to_minor( (string) $cart->get_total( 'edit' ), null, $currency );
	}

	/**
	 * Diagnostic: full total minus selected shipping+tax.
	 * NOT fed to Stripe Elements as the amount (Elements amount = amount_minor).
	 * Kept for tripwire logs and shipping-math reconcile (base + rate === full).
	 */
	public static function wallet_display_base_minor_from_cart(): int {
		$full = self::amount_minor_from_cart();
		$ship = self::selected_shipping_minor_from_cart();
		return max( 0, $full - $ship );
	}

	/** Selected shipping cost + its tax, in minor units (matches Stripe rate amounts). */
	public static function selected_shipping_minor_from_cart(): int {
		$cart = function_exists( 'WC' ) && WC() ? WC()->cart : null;
		if ( ! $cart ) {
			return 0;
		}
		$currency = strtolower( (string) get_woocommerce_currency() );
		$cost     = self::total_to_minor( (string) $cart->get_shipping_total(), null, $currency );
		$tax_sum  = 0.0;
		foreach ( (array) $cart->get_shipping_taxes() as $tax ) {
			$tax_sum += (float) $tax;
		}
		$tax = self::total_to_minor( (string) $tax_sum, null, $currency );
		return max( 0, $cost + $tax );
	}

	/**
	 * Privacy-safe category digests for stale diagnostics (never log field values).
	 *
	 * @param array<string,mixed> $payload Cart payload.
	 * @return array<string,string>
	 */
	public static function category_digests( array $payload ): array {
		$cats = array(
			'cart'       => array(
				'items'   => $payload['items'] ?? array(),
				'coupons' => $payload['coupons'] ?? array(),
			),
			'address'    => array(
				'billing'  => $payload['billing'] ?? array(),
				'shipping' => $payload['shipping'] ?? array(),
				'email'    => $payload['email'] ?? '',
			),
			'shipping'   => array(
				'methods'  => $payload['shipping_methods'] ?? array(),
				'packages' => $payload['shipping_packages'] ?? array(),
			),
			'totals'     => array(
				'amount_minor' => $payload['amount_minor'] ?? 0,
				'currency'     => $payload['currency'] ?? '',
				'taxes'        => $payload['taxes'] ?? array(),
			),
			'extensions' => array( 'extension_fields' => $payload['extension_fields'] ?? array() ),
		);
		$out = array();
		foreach ( $cats as $name => $slice ) {
			$out[ $name ] = hash( 'sha256', (string) wp_json_encode( self::canonicalize( $slice ) ) );
		}
		return $out;
	}

	/**
	 * Category names whose digests differ (for logs only — no values/hashes logged).
	 *
	 * @param array<string,string> $prior Prior digests.
	 * @param array<string,string> $next  Next digests.
	 * @return list<string>
	 */
	public static function changed_categories( array $prior, array $next ): array {
		$names = array( 'cart', 'address', 'shipping', 'totals', 'extensions' );
		$changed = array();
		foreach ( $names as $name ) {
			$a = (string) ( $prior[ $name ] ?? '' );
			$b = (string) ( $next[ $name ] ?? '' );
			if ( '' === $a || '' === $b || ! hash_equals( $a, $b ) ) {
				$changed[] = $name;
			}
		}
		return $changed;
	}

	/**
	 * DIAGNOSTIC (1.0.9.7): per-field digests of the address/shipping inputs so a
	 * "cart changed" invalidation can name the EXACT field that drifted instead of
	 * only the category. Digest-only — never stores or logs a field VALUE.
	 *
	 * @param array<string,mixed> $payload Cart payload.
	 * @return array<string,string>
	 */
	public static function address_field_digests( array $payload ): array {
		$out = array();
		foreach ( array( 'billing', 'shipping' ) as $side ) {
			$side_data = (array) ( $payload[ $side ] ?? array() );
			foreach ( self::ADDRESS_FIELDS as $field ) {
				$out[ $side . '_' . $field ] = hash( 'sha256', (string) ( $side_data[ $field ] ?? '' ) );
			}
		}
		$out['email']             = hash( 'sha256', strtolower( (string) ( $payload['email'] ?? '' ) ) );
		$out['shipping_methods']  = hash( 'sha256', (string) wp_json_encode( self::canonicalize( (array) ( $payload['shipping_methods'] ?? array() ) ) ) );
		$out['shipping_packages'] = hash( 'sha256', (string) wp_json_encode( self::canonicalize( (array) ( $payload['shipping_packages'] ?? array() ) ) ) );
		$out['amount_minor']      = hash( 'sha256', (string) ( $payload['amount_minor'] ?? 0 ) );
		return $out;
	}

	/**
	 * Field names whose digests differ (NAMES only — no values, no digests).
	 *
	 * @param array<string,string> $prior Prior field digests.
	 * @param array<string,string> $next  Next field digests.
	 * @return list<string>
	 */
	public static function changed_fields( array $prior, array $next ): array {
		if ( ! $prior || ! $next ) {
			return array();
		}
		$changed = array();
		foreach ( $next as $name => $digest ) {
			$before = (string) ( $prior[ $name ] ?? '' );
			if ( '' === $before || ! hash_equals( $before, (string) $digest ) ) {
				$changed[] = (string) $name;
			}
		}
		return $changed;
	}

	/**
	 * Fingerprint of the final Woo order (S6).
	 * Same canonical shape as payload_from_cart so process_payment can bind payment
	 * evidence to the order identity (email, addresses, items, coupons, totals).
	 *
	 * @param \WC_Order $order Final order about to be charged.
	 */
	public static function from_order( $order ): string {
		return hash( 'sha256', (string) wp_json_encode( self::canonicalize( self::payload_from_order( $order ) ) ) );
	}

	/** An existing order's payment identity never borrows a different cart/session. */
	public static function payment_order_payload( $order ): array {
		$payload = self::payload_from_order( $order );
		$stored = $order->get_meta( '_psc_checkout_extension_fields', true );
		$payload['extension_fields'] = is_array( $stored ) ? $stored : array();
		$payload['woo_order_id'] = (int) $order->get_id();
		return $payload;
	}
	public static function from_payment_order( $order ): string {
		return hash( 'sha256', (string) wp_json_encode( self::canonicalize( self::payment_order_payload( $order ) ) ) );
	}

	/**
	 * @param \WC_Order $order Order object.
	 * @return array<string,mixed>
	 */
	public static function payload_from_order( $order ): array {
		$billing  = array();
		$shipping = array();
		foreach ( self::ADDRESS_FIELDS as $field ) {
			// is_callable (not method_exists) so WC stubs with __call still resolve.
			$bill_m = 'get_billing_' . $field;
			$ship_m = 'get_shipping_' . $field;
			$billing[ $field ]  = ( $order && is_callable( array( $order, $bill_m ) ) ) ? (string) $order->{$bill_m}() : '';
			$shipping[ $field ] = ( $order && is_callable( array( $order, $ship_m ) ) ) ? (string) $order->{$ship_m}() : '';
		}
		if ( '' === trim( (string) ( $shipping['address_1'] ?? '' ) ) && '' === trim( (string) ( $shipping['city'] ?? '' ) ) && '' === trim( (string) ( $shipping['postcode'] ?? '' ) ) && '' !== trim( (string) ( $billing['address_1'] ?? '' ) ) ) {
			$shipping = $billing;
		}
		$items = array();
		if ( $order && method_exists( $order, 'get_items' ) ) {
			foreach ( (array) $order->get_items() as $line ) {
				if ( ! is_object( $line ) ) {
					continue;
				}
				$variation = array();
				if ( method_exists( $line, 'get_meta_data' ) ) {
					foreach ( (array) $line->get_meta_data() as $meta ) {
						if ( ! is_object( $meta ) || ! method_exists( $meta, 'get_data' ) ) {
							continue;
						}
						$data = $meta->get_data();
						$key  = (string) ( $data['key'] ?? '' );
						if ( '' === $key || str_starts_with( $key, '_' ) ) {
							continue;
						}
						$variation[ $key ] = (string) ( $data['value'] ?? '' );
					}
				}
				$items[] = array(
					'product_id'   => method_exists( $line, 'get_product_id' ) ? (int) $line->get_product_id() : 0,
					'variation_id' => method_exists( $line, 'get_variation_id' ) ? (int) $line->get_variation_id() : 0,
					'quantity'     => method_exists( $line, 'get_quantity' ) ? (int) $line->get_quantity() : 0,
					'variation'    => $variation,
					'line_total'   => method_exists( $line, 'get_total' ) ? (string) $line->get_total() : '',
					'line_tax'     => method_exists( $line, 'get_total_tax' ) ? (string) $line->get_total_tax() : '',
				);
			}
		}
		$coupons = array();
		if ( $order && method_exists( $order, 'get_coupon_codes' ) ) {
			$coupons = array_values( array_map( 'strval', (array) $order->get_coupon_codes() ) );
		}
		sort( $coupons, SORT_STRING );
		$currency = strtolower( $order && method_exists( $order, 'get_currency' ) ? (string) $order->get_currency() : (string) get_woocommerce_currency() );
		$shipping_methods = array();
		if ( $order && method_exists( $order, 'get_shipping_methods' ) ) {
			foreach ( (array) $order->get_shipping_methods() as $method ) {
				if ( is_object( $method ) && method_exists( $method, 'get_method_id' ) ) {
					$instance = method_exists( $method, 'get_instance_id' ) ? (string) $method->get_instance_id() : '';
					$id       = (string) $method->get_method_id();
					$shipping_methods[] = '' !== $instance ? $id . ':' . $instance : $id;
				}
			}
		}
		$packages = array(
			array(
				'package_id'    => 0,
				'destination'   => array(
					'country'  => (string) ( $shipping['country'] ?? '' ),
					'state'    => (string) ( $shipping['state'] ?? '' ),
					'postcode' => (string) ( $shipping['postcode'] ?? '' ),
					'city'     => (string) ( $shipping['city'] ?? '' ),
					'address'  => (string) ( $shipping['address_1'] ?? '' ),
					'address_2'=> (string) ( $shipping['address_2'] ?? '' ),
				),
				'contents_cost' => $order && method_exists( $order, 'get_subtotal' ) ? (string) $order->get_subtotal() : '',
			),
		);
		$session = function_exists( 'WC' ) && WC() ? WC()->session : null;
		$total   = $order && method_exists( $order, 'get_total' ) ? (string) $order->get_total() : '0';
		return array(
			'amount_minor'      => self::total_to_minor( $total, null, $currency ),
			'billing'           => $billing,
			'coupons'           => $coupons,
			'currency'          => $currency,
			'email'             => strtolower( $order && method_exists( $order, 'get_billing_email' ) ? (string) $order->get_billing_email() : '' ),
			'extension_fields'  => $session ? (array) $session->get( self::EXTENSION_SESSION, array() ) : array(),
			'items'             => $items,
			'shipping'          => $shipping,
			'shipping_methods'  => $shipping_methods,
			'shipping_packages' => $packages,
			'taxes'             => array(
				'cart'     => $order && method_exists( $order, 'get_tax_totals' ) ? array_map( static function ( $t ) {
					return is_object( $t ) && isset( $t->amount ) ? (string) $t->amount : '0';
				}, (array) $order->get_tax_totals() ) : array(),
				'shipping' => array(),
			),
		);
	}

	/**
	 * Stable identity digest for binding order ↔ attempt (S6).
	 * Subset of payload fields that define who/what is purchased — ignores
	 * shipping_packages shape differences between cart snapshot and order.
	 *
	 * @param array<string,mixed> $payload Cart or order payload.
	 */
	public static function identity_digest( array $payload ): string {
		$items = array();
		foreach ( (array) ( $payload['items'] ?? array() ) as $line ) {
			$items[] = array(
				'product_id'   => (int) ( $line['product_id'] ?? 0 ),
				'variation_id' => (int) ( $line['variation_id'] ?? 0 ),
				'quantity'     => (int) ( $line['quantity'] ?? 0 ),
				'line_total'   => (string) ( $line['line_total'] ?? '' ),
			);
		}
		$coupons = array_values( array_map( 'strval', (array) ( $payload['coupons'] ?? array() ) ) );
		sort( $coupons, SORT_STRING );
		$identity = array(
			'amount_minor' => (int) ( $payload['amount_minor'] ?? 0 ),
			'billing'      => (array) ( $payload['billing'] ?? array() ),
			'coupons'      => $coupons,
			'currency'     => strtolower( (string) ( $payload['currency'] ?? '' ) ),
			'email'        => strtolower( (string) ( $payload['email'] ?? '' ) ),
			'items'        => $items,
			'shipping'     => (array) ( $payload['shipping'] ?? array() ),
		);
		return hash( 'sha256', (string) wp_json_encode( self::canonicalize( $identity ) ) );
	}


	public static function identity_from_cart(): string {
		return self::identity_digest( self::payload_from_cart() );
	}

	/** @param \WC_Order $order Order object. */
	public static function identity_from_order( $order ): string {
		return self::identity_digest( self::payload_from_order( $order ) );
	}
	/**
	 * Extension namespaces that must never take part in the cart fingerprint.
	 *
	 * 0.1.3.2: WooCommerce Order Attribution is analytics metadata. Woo's own
	 * order-attribution script sets it on the Blocks checkout store only once the
	 * checkout form (with its hidden wc_order_attribution_* inputs) has rendered,
	 * which in the wallet-first layout happens AFTER the payment attempt was created
	 * from an empty extensions snapshot. The final checkout POST then carries
	 * source_type/session_pages/user_agent/... and process_payment refused the order
	 * with "Your cart changed before payment" (changed category: extensions, fields
	 * none, delta 0 — BB Peptides order #399, 2026-09-14). Attribution is not cart
	 * content and cannot change what the buyer pays, so it is excluded here at the
	 * single choke point both the create_attempt snapshot and the checkout POST use.
	 */
	private const IGNORED_EXTENSION_NAMESPACES = array( 'woocommerce/order-attribution' );

	public static function remember_extension_fields( array $fields ): void {
		foreach ( self::IGNORED_EXTENSION_NAMESPACES as $namespace ) {
			unset( $fields[ $namespace ] );
		}
		$clean = array();
		foreach ( $fields as $key => $value ) {
			if ( is_scalar( $value ) || is_array( $value ) ) {
				$clean[ sanitize_text_field( (string) $key ) ] = self::clean( $value );
			}
		}
		if ( function_exists( 'WC' ) && WC() && WC()->session ) {
			WC()->session->set( self::EXTENSION_SESSION, $clean );
		}
	}
	public static function payload_from_cart(): array {
		$wc = function_exists( 'WC' ) ? WC() : null;
		$customer = $wc ? $wc->customer : null;
		$cart = $wc ? $wc->cart : null;
		$session = $wc ? $wc->session : null;
		$billing = array();
		$shipping = array();
		foreach ( self::ADDRESS_FIELDS as $field ) {
			$billing[ $field ] = $customer ? (string) $customer->{ 'get_billing_' . $field }() : '';
			$shipping[ $field ] = $customer ? (string) $customer->{ 'get_shipping_' . $field }() : '';
		}
		// Mirror Woo ship-to-same: empty shipping + non-truthy ship_to_different uses billing.
		$ship_flag = $session ? $session->get( 'ship_to_different_address', '' ) : '';
		$ship_diff = is_bool( $ship_flag ) ? $ship_flag : in_array( strtolower( trim( (string) $ship_flag ) ), array( '1', 'yes', 'true', 'on' ), true );
		if ( ! $ship_diff && '' === trim( (string) ( $shipping['address_1'] ?? '' ) ) && '' === trim( (string) ( $shipping['city'] ?? '' ) ) && '' === trim( (string) ( $shipping['postcode'] ?? '' ) ) && '' !== trim( (string) ( $billing['address_1'] ?? '' ) ) ) {
			$shipping = $billing;
		}
		$items = array();
		foreach ( $cart ? (array) $cart->get_cart() : array() as $line ) {
			$items[] = array(
				'product_id'   => (int) ( $line['product_id'] ?? 0 ),
				'variation_id' => (int) ( $line['variation_id'] ?? 0 ),
				'quantity'     => (int) ( $line['quantity'] ?? 0 ),
				'variation'    => (array) ( $line['variation'] ?? array() ),
				'line_total'   => (string) ( $line['line_total'] ?? '' ),
				'line_tax'     => (string) ( $line['line_tax'] ?? '' ),
			);
		}
		$coupons = $cart ? array_values( array_map( 'strval', (array) $cart->get_applied_coupons() ) ) : array();
		sort( $coupons, SORT_STRING );
		$packages = array();
		foreach ( $cart ? (array) $cart->get_shipping_packages() : array() as $index => $package ) {
			$packages[] = array( 'package_id' => $package['package_id'] ?? $index, 'destination' => (array) ( $package['destination'] ?? array() ), 'contents_cost' => (string) ( $package['contents_cost'] ?? '' ) );
		}
			$currency = strtolower( (string) get_woocommerce_currency() );
		return array(
			'amount_minor' => $cart ? self::total_to_minor( (string) $cart->get_total( 'edit' ), null, $currency ) : 0,
			'billing' => $billing,
			'coupons' => $coupons,
			'currency' => $currency,
			'email' => strtolower( $customer ? (string) $customer->get_billing_email() : '' ),
			'extension_fields' => $session ? (array) $session->get( self::EXTENSION_SESSION, array() ) : array(),
			'items' => $items,
			'shipping' => $shipping,
			'shipping_methods' => $session ? array_values( (array) $session->get( 'chosen_shipping_methods', array() ) ) : array(),
			'shipping_packages' => $packages,
			'taxes' => $cart ? array( 'cart' => (array) $cart->get_taxes(), 'shipping' => (array) $cart->get_shipping_taxes() ) : array(),
		);
	}

	/**
	 * Stripe minor-unit exponent for a currency (NOT Woo display decimals).
	 * Zero-decimal and three-decimal sets follow Stripe's currency docs.
	 */
	public static function currency_minor_exponent( string $currency ): int {
		$currency = strtolower( trim( $currency ) );
		static $zero = array(
			'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
		);
		static $three = array( 'bhd', 'jod', 'kwd', 'omr', 'tnd' );
		if ( in_array( $currency, $zero, true ) ) {
			return 0;
		}
		if ( in_array( $currency, $three, true ) ) {
			return 3;
		}
		return 2;
	}

	/**
	 * Decimal-string to minor-unit conversion with integer half-up rounding.
	 * When $decimals is null, uses Stripe currency exponent (never wc_get_price_decimals).
	 *
	 * @param string      $total    Amount string.
	 * @param int|null    $decimals Explicit exponent override (tests only).
	 * @param string|null $currency ISO currency for exponent lookup when $decimals is null.
	 */
	public static function total_to_minor( string $total, ?int $decimals = null, ?string $currency = null ): int {
		if ( null === $decimals ) {
			$cur = $currency;
			if ( null === $cur || '' === $cur ) {
				$cur = function_exists( 'get_woocommerce_currency' ) ? (string) get_woocommerce_currency() : 'usd';
			}
			$decimals = self::currency_minor_exponent( $cur );
		}
		$decimals = max( 0, (int) $decimals );
		$negative = str_starts_with( trim( $total ), '-' );
		$clean = preg_replace( '/[^0-9.]/', '', $total );
		if ( ! $clean ) {
			return 0;
		}
		$parts = explode( '.', $clean, 2 );
		$whole = ltrim( $parts[0], '0' ) ?: '0';
		$fraction = preg_replace( '/\D/', '', $parts[1] ?? '' );
		$padded = str_pad( $fraction, $decimals + 1, '0' );
		$minor = (int) $whole * ( 10 ** $decimals ) + (int) substr( $padded, 0, $decimals );
		if ( (int) ( $padded[ $decimals ] ?? '0' ) >= 5 ) {
			++$minor;
		}
		return $negative ? -$minor : $minor;
	}
	private static function canonicalize( $value ) {
		if ( ! is_array( $value ) ) {
			return $value;
		}
		if ( array_keys( $value ) !== range( 0, count( $value ) - 1 ) ) {
			ksort( $value, SORT_STRING );
		}
		foreach ( $value as $key => $item ) {
			$value[ $key ] = self::canonicalize( $item );
		}
		return $value;
	}
	private static function clean( $value ) {
		if ( ! is_array( $value ) ) { return sanitize_text_field( (string) $value ); }
		$out = array();
		foreach ( $value as $key => $item ) { $out[ sanitize_text_field( (string) $key ) ] = self::clean( $item ); }
		return $out;
	}
}
