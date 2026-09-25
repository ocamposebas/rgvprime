<?php
namespace PrismSimpleCheckout;
defined( 'ABSPATH' ) || exit;

/**
 * Apply Woo Pay address transforms to the customer before fingerprinting.
 * Mirror order: clean + field filters → ship-to-same copy → checkout_posted_data → postcode/phone/state.
 */
final class Address_Canonical {
	public const PARTS = array( 'first_name', 'last_name', 'company', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country', 'phone' );

	public static function field_keys(): array {
		$keys = array( 'billing_email' );
		foreach ( self::PARTS as $part ) {
			$keys[] = 'billing_' . $part;
			$keys[] = 'shipping_' . $part;
		}
		return $keys;
	}

	public static function is_ship_different( $flag ): bool {
		if ( is_bool( $flag ) ) {
			return $flag;
		}
		return in_array( strtolower( trim( (string) $flag ) ), array( '1', 'yes', 'true', 'on' ), true );
	}

	/**
	 * @param array<string,mixed> $raw Posted identity fields.
	 * @return array<string,string>
	 */
	public static function apply_posted_to_customer( array $raw, $ship_flag ): array {
		if ( ! function_exists( 'WC' ) || ! WC() || ! WC()->customer ) {
			return array();
		}
		$data = array();
		foreach ( self::field_keys() as $key ) {
			if ( ! array_key_exists( $key, $raw ) ) {
				continue;
			}
			$value = $raw[ $key ];
			if ( 'billing_email' === $key ) {
				$value = sanitize_email( (string) $value );
			} else {
				$value = function_exists( 'wc_clean' ) ? wc_clean( (string) $value ) : sanitize_text_field( (string) $value );
			}
			$type  = self::field_type( $key );
			$value = apply_filters( 'woocommerce_process_checkout_' . $type . '_field', apply_filters( 'woocommerce_process_checkout_field_' . $key, $value ) );
			$data[ $key ] = is_scalar( $value ) ? (string) $value : '';
		}
		$ship_different = self::is_ship_different( $ship_flag );
		$billing_only   = function_exists( 'wc_ship_to_billing_address_only' ) && wc_ship_to_billing_address_only();
		$needs_ship     = true;
		if ( WC()->cart && method_exists( WC()->cart, 'needs_shipping_address' ) ) {
			$needs_ship = (bool) WC()->cart->needs_shipping_address();
		} elseif ( WC()->cart && method_exists( WC()->cart, 'needs_shipping' ) ) {
			$needs_ship = (bool) WC()->cart->needs_shipping();
		}
		if ( ! $ship_different || $billing_only || ! $needs_ship ) {
			foreach ( self::PARTS as $part ) {
				$bill_key = 'billing_' . $part;
				if ( array_key_exists( $bill_key, $data ) ) {
					$data[ 'shipping_' . $part ] = $data[ $bill_key ];
				}
			}
		}
		$data = apply_filters( 'woocommerce_checkout_posted_data', $data );
		if ( ! is_array( $data ) ) {
			$data = array();
		}
		$data = self::format_like_validate( $data );
		foreach ( $data as $key => $value ) {
			$value = (string) $value;
			if ( 'billing_email' === $key ) {
				if ( is_email( $value ) ) {
					WC()->customer->set_billing_email( $value );
				}
				continue;
			}
			$setter = 'set_' . $key;
			if ( is_callable( array( WC()->customer, $setter ) ) ) {
				WC()->customer->{$setter}( $value );
			}
		}
		WC()->customer->save();
		if ( WC()->session ) {
			WC()->session->set( 'ship_to_different_address', ( $ship_different && ! $billing_only && $needs_ship ) ? '1' : '0' );
		}
		if ( WC()->cart ) {
			WC()->cart->calculate_shipping();
			WC()->cart->calculate_totals();
		}
		return $data;
	}

	/**
	 * @param array<string,string> $data Posted data after filters.
	 * @return array<string,string>
	 */
	private static function format_like_validate( array $data ): array {
		foreach ( array( 'billing', 'shipping' ) as $side ) {
			$country = (string) ( $data[ $side . '_country' ] ?? '' );
			if ( isset( $data[ $side . '_postcode' ] ) && function_exists( 'wc_format_postcode' ) ) {
				$data[ $side . '_postcode' ] = wc_format_postcode( (string) $data[ $side . '_postcode' ], $country );
			}
			if ( isset( $data[ $side . '_phone' ] ) && function_exists( 'wc_remove_non_displayable_chars' ) ) {
				$data[ $side . '_phone' ] = wc_remove_non_displayable_chars( (string) $data[ $side . '_phone' ] );
			}
			if ( isset( $data[ $side . '_state' ] ) ) {
				$data[ $side . '_state' ] = self::canonical_state( (string) $data[ $side . '_state' ], $country );
			}
		}
		if ( isset( $data['billing_email'] ) ) {
			$data['billing_email'] = sanitize_email( (string) $data['billing_email'] );
		}
		return $data;
	}

	private static function canonical_state( string $state, string $country ): string {
		$state = function_exists( 'wc_strtoupper' ) ? wc_strtoupper( $state ) : strtoupper( $state );
		if ( ! function_exists( 'WC' ) || ! WC() || ! isset( WC()->countries ) || ! method_exists( WC()->countries, 'get_states' ) ) {
			return $state;
		}
		$states = WC()->countries->get_states( $country );
		if ( ! is_array( $states ) || ! $states ) {
			return $state;
		}
		$upper = function_exists( 'wc_strtoupper' ) ? 'wc_strtoupper' : 'strtoupper';
		$valid = array_map( $upper, array_flip( array_map( $upper, $states ) ) );
		if ( isset( $valid[ $state ] ) ) {
			return (string) $valid[ $state ];
		}
		return $state;
	}

	private static function field_type( string $key ): string {
		if ( 'billing_email' === $key ) {
			return 'email';
		}
		if ( str_ends_with( $key, '_phone' ) ) {
			return 'tel';
		}
		return 'text';
	}
}
