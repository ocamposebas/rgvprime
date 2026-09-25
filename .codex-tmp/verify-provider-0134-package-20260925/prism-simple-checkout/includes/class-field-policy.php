<?php
namespace PrismSimpleCheckout;
defined( 'ABSPATH' ) || exit;
/** Wallets may populate core fields only when Woo has one simple shipping package. */
final class Field_Policy {
	/** Register checkout-field filters (phone optional on PSC surfaces). */
	public function hooks(): void {
		add_filter( 'woocommerce_billing_fields', array( $this, 'make_phone_optional' ), 1000, 2 );
		add_filter( 'woocommerce_checkout_fields', array( $this, 'make_checkout_phone_optional' ), 1000 );
		add_filter( 'woocommerce_default_address_fields', array( $this, 'make_default_phone_optional' ), 1000 );
	}

	/**
	 * Privacy: phone is never mandatory on PSC checkouts (classic card + express).
	 *
	 * @param array<string,mixed> $fields Billing fields.
	 * @param string              $country Country code (unused).
	 * @return array<string,mixed>
	 */
	public function make_phone_optional( array $fields, $country = '' ): array {
		unset( $country );
		if ( isset( $fields['billing_phone'] ) && is_array( $fields['billing_phone'] ) ) {
			$fields['billing_phone']['required'] = false;
		}
		if ( isset( $fields['phone'] ) && is_array( $fields['phone'] ) ) {
			$fields['phone']['required'] = false;
		}
		return $fields;
	}

	/**
	 * @param array<string,mixed> $fields Checkout field groups.
	 * @return array<string,mixed>
	 */
	public function make_checkout_phone_optional( array $fields ): array {
		if ( isset( $fields['billing']['billing_phone'] ) && is_array( $fields['billing']['billing_phone'] ) ) {
			$fields['billing']['billing_phone']['required'] = false;
		}
		if ( isset( $fields['shipping']['shipping_phone'] ) && is_array( $fields['shipping']['shipping_phone'] ) ) {
			$fields['shipping']['shipping_phone']['required'] = false;
		}
		return $fields;
	}

	/**
	 * @param array<string,mixed> $fields Default address fields.
	 * @return array<string,mixed>
	 */
	public function make_default_phone_optional( array $fields ): array {
		if ( isset( $fields['phone'] ) && is_array( $fields['phone'] ) ) {
			$fields['phone']['required'] = false;
		}
		return $fields;
	}

	public function needs_shipping(): bool {
		return function_exists( 'WC' ) && WC() && WC()->cart && (bool) WC()->cart->needs_shipping();
	}
	public function is_multi_package(): bool {
		return function_exists( 'WC' ) && WC() && WC()->cart && count( (array) WC()->cart->get_shipping_packages() ) > 1;
	}
	public function has_custom_required_fields(): bool {
		return (bool) apply_filters( 'psc_has_custom_required_fields', false );
	}
	public function requires_native_fallback(): bool {
		return $this->is_multi_package() || $this->has_custom_required_fields();
	}
	public function wallet_may_populate_core_fields(): bool {
		return ! $this->requires_native_fallback();
	}
	/**
	 * Phone is never required under PSC (privacy). Express + card both accept empty phone.
	 */
	public function billing_phone_required(): bool {
		return false;
	}
	public function native_surface_snapshot(): array {
		$selections = array();
		if ( function_exists( 'WC' ) && WC() && WC()->cart ) {
			foreach ( (array) WC()->cart->get_shipping_packages() as $package ) {
				if ( ! empty( $package['rate_id'] ) ) { $selections[] = (string) $package['rate_id']; }
			}
		}
		return array(
			'native_fields_intact' => true,
			'package_selections' => $selections,
			'hide_native_fields' => false,
			'hide_extension_fields' => false,
			'native_fallback' => $this->requires_native_fallback(),
			'wallet_populate_core' => $this->wallet_may_populate_core_fields(),
			'needs_shipping' => $this->needs_shipping(),
			'phone_required' => $this->billing_phone_required(),
			'shipping_rates' => $this->shipping_rates_for_wallet(),
		);
	}

	/**
	 * Wallet Express shipping rates for the current request.
	 * Prefers WC()->shipping()->get_packages() (production primary path).
	 * Chosen session rate is listed first so Stripe's default matches the session
	 * (Elements amount is full amount_minor which already includes that rate).
	 *
	 * @return list<array{id:string,display_name:string,amount:int}>
	 */
	public function shipping_rates_for_wallet(): array {
		if ( ! function_exists( 'WC' ) || ! WC() || ! WC()->cart || ! $this->needs_shipping() ) {
			return array();
		}
		$packages = method_exists( WC(), 'shipping' )
			? (array) WC()->shipping()->get_packages()
			: (array) WC()->cart->get_shipping_packages();
		$rates = array();
		foreach ( $packages as $package ) {
			$package_rates = (array) ( $package['rates'] ?? array() );
			if ( empty( $package_rates ) && ! empty( $package['rate_id'] ) ) {
				$id = (string) $package['rate_id'];
				$rates[ $id ] = array(
					'id'           => $id,
					'display_name' => (string) ( $package['label'] ?? $id ),
					'amount'       => Cart_Fingerprint::total_to_minor( (string) ( $package['amount'] ?? 0 ) ),
				);
			}
			foreach ( $package_rates as $rate ) {
				if ( ! is_object( $rate ) || ! method_exists( $rate, 'get_id' ) ) {
					continue;
				}
				$id     = (string) $rate->get_id();
				$amount = (float) $rate->get_cost() + array_sum( array_map( 'floatval', (array) $rate->get_taxes() ) );
				$rates[ $id ] = array(
					'id'           => $id,
					'display_name' => (string) $rate->get_label(),
					'amount'       => Cart_Fingerprint::total_to_minor( (string) $amount ),
				);
			}
		}
		return self::order_chosen_rate_first( array_values( $rates ) );
	}

	/**
	 * Stripe defaults to shippingRates[0] with no shippingratechange event.
	 * Put the session-chosen rate first so the picker default matches the rate
	 * already included in amount_minor (Elements pay total).
	 *
	 * @param list<array{id:string,display_name:string,amount:int}> $rates
	 * @return list<array{id:string,display_name:string,amount:int}>
	 */
	public static function order_chosen_rate_first( array $rates ): array {
		if ( count( $rates ) < 2 ) {
			return $rates;
		}
		$chosen = '';
		if ( function_exists( 'WC' ) && WC() && WC()->session ) {
			$methods = (array) WC()->session->get( 'chosen_shipping_methods', array() );
			$chosen  = (string) ( $methods[0] ?? '' );
		}
		if ( '' === $chosen ) {
			return $rates;
		}
		$first = array();
		$rest  = array();
		foreach ( $rates as $rate ) {
			if ( (string) ( $rate['id'] ?? '' ) === $chosen ) {
				$first[] = $rate;
			} else {
				$rest[] = $rate;
			}
		}
		return array_merge( $first, $rest );
	}
}
