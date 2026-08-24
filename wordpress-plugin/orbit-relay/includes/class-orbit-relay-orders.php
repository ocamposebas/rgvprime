<?php

defined( 'ABSPATH' ) || exit;

final class ORBIT_Relay_Orders {
    public static function get_summary( int $order_id ) {
        if ( ! ORBIT_Relay::is_woocommerce_available() ) {
            return new WP_Error( 'orbit_woocommerce_unavailable', 'WooCommerce is unavailable.', array( 'status' => 503 ) );
        }

        $order = wc_get_order( $order_id );
        if ( ! $order ) {
            return new WP_Error( 'orbit_order_not_found', 'Order not found.', array( 'status' => 404 ) );
        }

        $status            = (string) $order->get_status();
        $currency          = strtoupper( (string) $order->get_currency() );
        $total             = (string) $order->get_total();
        $total_minor       = self::decimal_to_minor( $total, $currency );
        $paid              = (bool) $order->is_paid();
        $payment_required  = ! $paid && $total_minor > 0 && ! in_array( $status, array( 'cancelled', 'refunded', 'failed', 'trash' ), true );
        $date              = $order->get_date_created();
        $transaction       = (string) $order->get_meta( '_orbit_transaction_id', true );

        return array(
            'order_id'               => $order->get_id(),
            'status'                 => $status,
            'currency'               => $currency,
            'total_minor'            => $total_minor,
            'payment_required'       => $payment_required,
            'paid'                   => $paid,
            'date_created'           => $date ? $date->date( DATE_ATOM ) : null,
            'orbit_transaction_id'   => '' !== $transaction ? $transaction : null,
        );
    }

    /**
     * Complete an ORBIT payment synchronization request.
     *
     * Production transactions (orb_tx_*) are accepted only in the production
     * Relay environment and only after the REST layer has authenticated the
     * request with ORBIT HMAC. Controlled test transactions (orb_test_*) still
     * require the explicit test-mode switch.
     */
    public static function complete_payment( int $order_id, string $transaction_id, string $payment_reference = '' ) {
        if ( ! ORBIT_Relay::is_woocommerce_available() ) {
            return new WP_Error( 'orbit_woocommerce_unavailable', 'WooCommerce is unavailable.', array( 'status' => 503 ) );
        }

        $is_production = (bool) preg_match( '/^orb_tx_[A-Za-z0-9_-]{8,160}$/', $transaction_id );
        $is_test       = (bool) preg_match( '/^orb_test_[A-Za-z0-9_-]{8,120}$/', $transaction_id );

        if ( ! $is_production && ! $is_test ) {
            return new WP_Error( 'orbit_transaction_invalid', 'A valid ORBIT transaction ID is required.', array( 'status' => 400 ) );
        }

        if ( $is_test && ! ORBIT_Relay::allow_test_payment_completion() ) {
            return new WP_Error( 'orbit_test_mode_disabled', 'Controlled test payment completion is disabled.', array( 'status' => 403 ) );
        }

        if ( $is_production && 'production' !== ORBIT_Relay::environment() ) {
            return new WP_Error( 'orbit_production_payment_wrong_environment', 'Production payment synchronization is not allowed in this Relay environment.', array( 'status' => 409 ) );
        }

        $payment_reference = self::normalize_payment_reference( $payment_reference );
        if ( is_wp_error( $payment_reference ) ) {
            return $payment_reference;
        }

        $order = wc_get_order( $order_id );
        if ( ! $order ) {
            return new WP_Error( 'orbit_order_not_found', 'Order not found.', array( 'status' => 404 ) );
        }

        $existing           = (string) $order->get_meta( '_orbit_transaction_id', true );
        $existing_reference = (string) $order->get_meta( '_orbit_payment_reference', true );

        if ( '' !== $existing && ! hash_equals( $existing, $transaction_id ) ) {
            return new WP_Error(
                'orbit_conflicting_payment',
                'Order is associated with a different ORBIT transaction. Manual review is required.',
                array( 'status' => 409 )
            );
        }

        if ( $order->is_paid() ) {
            if ( '' !== $existing && hash_equals( $existing, $transaction_id ) ) {
                // A later retry may include a Stripe reference that was absent on
                // the first callback. Reconcile missing metadata without replaying
                // WooCommerce payment_complete().
                if ( '' === $existing_reference && '' !== $payment_reference ) {
                    self::store_payment_metadata( $order, $transaction_id, $payment_reference, $is_test );
                    $order->save();
                }

                return array(
                    'ok'                => true,
                    'already_processed' => true,
                    'order_id'          => $order_id,
                    'status'            => $order->get_status(),
                    'transaction_id'    => $transaction_id,
                );
            }

            return new WP_Error(
                'orbit_conflicting_payment',
                'Order is already paid by a different transaction. Manual review is required.',
                array( 'status' => 409 )
            );
        }

        $summary = self::get_summary( $order_id );
        if ( is_wp_error( $summary ) ) {
            return $summary;
        }
        if ( empty( $summary['payment_required'] ) ) {
            return new WP_Error( 'orbit_order_not_payable', 'Order is not payable.', array( 'status' => 409 ) );
        }

        self::store_payment_metadata( $order, $transaction_id, $payment_reference, $is_test );
        $order->save();

        // WooCommerce remains responsible for choosing the resulting paid order
        // status (normally processing/completed depending on the order contents).
        $order->payment_complete( $transaction_id );

        $note = $is_test
            ? sprintf( 'ORBIT Relay controlled test payment synchronization completed. Transaction: %s', $transaction_id )
            : sprintf( 'ORBIT Relay production payment synchronization completed. Transaction: %s', $transaction_id );

        if ( '' !== $payment_reference ) {
            $note .= sprintf( ' · Payment reference: %s', $payment_reference );
        }
        $order->add_order_note( $note );

        ORBIT_Relay::touch_sync();
        ORBIT_Relay_Logger::log(
            $is_test ? 'ORBIT_PAYMENT_SYNC_TEST' : 'ORBIT_PAYMENT_SYNC',
            $is_test ? 'Controlled test payment completion succeeded.' : 'Production payment completion succeeded.',
            array(
                'order_id'          => $order_id,
                'transaction_id'    => $transaction_id,
                'payment_reference' => $payment_reference,
            )
        );

        $order = wc_get_order( $order_id );
        return array(
            'ok'                => true,
            'already_processed' => false,
            'order_id'          => $order_id,
            'status'            => $order ? $order->get_status() : 'unknown',
            'transaction_id'    => $transaction_id,
        );
    }

    /**
     * Backward-compatible Phase 1 method used by any existing test tooling.
     */
    public static function complete_test_payment( int $order_id, string $transaction_id ) {
        return self::complete_payment( $order_id, $transaction_id, '' );
    }

    private static function store_payment_metadata( $order, string $transaction_id, string $payment_reference, bool $is_test ): void {
        $order->update_meta_data( '_orbit_transaction_id', $transaction_id );
        $order->update_meta_data( '_orbit_payment_status', $is_test ? 'succeeded_test' : 'succeeded' );
        $order->update_meta_data( '_orbit_payment_mode', $is_test ? 'test' : 'production' );
        $order->update_meta_data( '_orbit_last_sync_at', gmdate( 'c' ) );
        $order->update_meta_data( '_orbit_relay_version', ORBIT_RELAY_VERSION );

        if ( '' !== $payment_reference ) {
            $order->update_meta_data( '_orbit_payment_reference', $payment_reference );
            if ( str_starts_with( $payment_reference, 'pi_' ) ) {
                $order->update_meta_data( '_orbit_stripe_payment_intent_id', $payment_reference );
            }
        }
    }

    private static function normalize_payment_reference( string $payment_reference ) {
        $payment_reference = trim( $payment_reference );
        if ( '' === $payment_reference ) {
            return '';
        }

        if ( strlen( $payment_reference ) > 191 || ! preg_match( '/^[A-Za-z0-9_:\-]+$/', $payment_reference ) ) {
            return new WP_Error( 'orbit_payment_reference_invalid', 'Payment reference is invalid.', array( 'status' => 400 ) );
        }

        return $payment_reference;
    }

    public static function decimal_to_minor( string $amount, string $currency ): int {
        $exponent = self::currency_exponent( $currency );
        $amount   = trim( str_replace( ',', '', $amount ) );

        if ( ! preg_match( '/^-?\d+(?:\.\d+)?$/', $amount ) ) {
            return 0;
        }

        $negative = str_starts_with( $amount, '-' );
        if ( $negative ) {
            $amount = substr( $amount, 1 );
        }

        $parts = explode( '.', $amount, 2 );
        $whole = ltrim( $parts[0], '0' );
        $whole = '' === $whole ? '0' : $whole;
        $frac  = $parts[1] ?? '';

        if ( 0 === $exponent ) {
            $minor = (int) $whole;
        } else {
            $frac = substr( str_pad( $frac, $exponent, '0' ), 0, $exponent );
            $minor = ( (int) $whole * ( 10 ** $exponent ) ) + (int) $frac;
        }

        return $negative ? -$minor : $minor;
    }

    private static function currency_exponent( string $currency ): int {
        $currency = strtoupper( $currency );

        $zero_decimal = array(
            'BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF',
        );
        $three_decimal = array( 'BHD', 'JOD', 'KWD', 'OMR', 'TND' );

        if ( in_array( $currency, $zero_decimal, true ) ) {
            return 0;
        }
        if ( in_array( $currency, $three_decimal, true ) ) {
            return 3;
        }
        return 2;
    }
}
