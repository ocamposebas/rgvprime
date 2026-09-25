<?php
namespace PrismSimpleCheckout;
defined( 'ABSPATH' ) || exit;
/**
 * Single buyer-facing copy table for Classic + Blocks (GROK-UI-CONFIRM §4).
 * PHP AJAX/gateway surfaces and JS `buyerCopy` must stay aligned.
 */
final class Buyer_Copy {
	public const OTP_SEND_FAILED        = "We couldn’t send the code. Check your connection and tap Send code again.";
	public const OTP_SEND_AMBIGUOUS     = "We couldn’t confirm the email was sent. Wait a moment and tap Resend.";
	public const OTP_SEND_REJECTED      = "We couldn’t send to that address. Check the email and try again.";
	public const OTP_RESEND_COOLDOWN    = 'Wait a minute before requesting another code.';
	public const OTP_SEND_RATE_LIMITED  = 'Too many codes sent to this email this hour. Try again later.';
	public const OTP_CODE_MISMATCH      = "That code doesn’t match. Check the 6 digits and try again.";
	public const OTP_ATTEMPTS_EXHAUSTED = 'Too many incorrect tries. Wait for a new code, or tap Resend after it expires.';
	public const OTP_CODE_EXPIRED       = 'That code expired. Tap Resend for a new one.';
	public const OTP_VERIFY_RACE        = 'The code is right but confirmation is still catching up — wait 10 seconds and try again.';
	public const CART_STALE_JS          = 'Your cart total changed. Review your order and try payment again.';
	public const CART_STALE_PAY         = 'Your cart changed before payment. Review the total and try again.';
	public const CHECKOUT_CLAIM_BUSY    = 'Another payment is already starting. Wait a few seconds and try again.';
	public const CREATE_ATTEMPT_FAILED  = "We couldn’t start payment. Wait a moment and try again.";
	public const WALLET_CANCEL          = 'Payment cancelled. Nothing was charged.';
	public const PE_INCOMPLETE          = 'Payment details are incomplete. Check the card and try again.';
	public const CARD_DECLINED          = 'The card was declined. Try another card or pay a different way.';
	public const CONFIRM_PENDING        = 'Payment is still confirming. Don’t submit again — wait or refresh.';
	public const POLL_UNAVAILABLE       = "We can’t confirm payment status yet. Refresh this page. Don’t pay twice.";
	public const INVALID_NONCE          = 'This checkout page expired. Refresh and try again.';
	public const TERMS_UNAVAILABLE      = 'Checkout terms are unavailable. This order cannot be placed.';
	public const THREEDS_PENDING        = 'Your bank needs a quick extra check. Finish that prompt — don’t close the tab.';

	public static function otp_challenge_error( \WP_Error $error ): array {
		$hint = self::service_hint( $error );
		if ( 'otp resend cooldown' === $hint ) {
			return array( 'code' => 'otp_resend_cooldown', 'message' => self::OTP_RESEND_COOLDOWN, 'status' => 429 );
		}
		if ( 'otp send rate limited' === $hint ) {
			return array( 'code' => 'otp_send_rate_limited', 'message' => self::OTP_SEND_RATE_LIMITED, 'status' => 429 );
		}
		return array( 'code' => 'otp_send_failed', 'message' => self::OTP_SEND_FAILED, 'status' => 502 );
	}

	public static function otp_verify_error( \WP_Error $error ): array {
		$hint   = self::service_hint( $error );
		$status = self::service_status( $error );
		if ( 'code mismatch' === $hint ) {
			return array( 'code' => 'otp_code_mismatch', 'message' => self::OTP_CODE_MISMATCH, 'status' => 400 );
		}
		if ( 'too many attempts' === $hint ) {
			return array( 'code' => 'otp_attempts_exhausted', 'message' => self::OTP_ATTEMPTS_EXHAUSTED, 'status' => 429 );
		}
		if ( 'challenge expired' === $hint || 410 === $status || 'gone' === $hint ) {
			return array( 'code' => 'otp_code_expired', 'message' => self::OTP_CODE_EXPIRED, 'status' => 410 );
		}
		if ( 'verified delivery required' === $hint || ( 401 === $status && 'verification_required' === self::service_code( $error ) ) ) {
			return array( 'code' => 'otp_verify_race', 'message' => self::OTP_VERIFY_RACE, 'status' => 401 );
		}
		return array( 'code' => 'otp_verify_failed', 'message' => self::OTP_CODE_MISMATCH, 'status' => 400 );
	}

	public static function service_hint( \WP_Error $error ): string {
		$data = $error->get_error_data();
		if ( is_array( $data ) && '' !== (string) ( $data['message'] ?? '' ) ) {
			return (string) $data['message'];
		}
		return (string) $error->get_error_message();
	}

	public static function service_code( \WP_Error $error ): string {
		$data = $error->get_error_data();
		return is_array( $data ) ? (string) ( $data['service_code'] ?? '' ) : '';
	}

	public static function service_status( \WP_Error $error ): int {
		$data = $error->get_error_data();
		return is_array( $data ) ? (int) ( $data['status'] ?? 0 ) : 0;
	}
}
