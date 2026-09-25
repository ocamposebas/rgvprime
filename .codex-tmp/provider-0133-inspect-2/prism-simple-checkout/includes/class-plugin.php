<?php
namespace PrismSimpleCheckout;
defined( 'ABSPATH' ) || exit;
/** Composition root shared by Classic checkout, Blocks, callbacks, and refunds. */
final class Plugin {
	private static $instance;
	private $service_client;
	private $checkout_claim;
	private $attempt_state;
	private $legal;
	private $field_policy;
	private $completion;
	private $reconciler;
	private $refunds;
	private $settings;
	private $rest;
	private function __construct() {
		$this->service_client = new Service_Client();
		$this->checkout_claim = new Checkout_Claim();
		$this->attempt_state = new Attempt_State();
		$this->legal = new Legal();
		$this->field_policy = new Field_Policy();
		$this->completion = new Completion();
		$this->reconciler = new Reconciler();
		$this->refunds = new Refunds();
		$this->settings = new Settings();
		$this->rest = new Rest_Routes();
	}
	public static function instance(): self {
		return self::$instance ?? ( self::$instance = new self() );
	}
	public static function boot(): void {
		self::instance()->register();
	}
	public static function activate(): void {
		if ( PSC_VERIFICATION_ONLY ) { return; }
		if ( ! Checkout_Claim::install_table() ) {
			deactivate_plugins( plugin_basename( PSC_PLUGIN_FILE ) );
			wp_die( esc_html__( 'PRISM checkout could not create its atomic claim table.', 'prism-simple-checkout' ) );
		}
		self::instance()->reconciler()->ensure_scheduled();
		// Fresh install usually has no credentials — never mark ensured without a signed request.
		if ( class_exists( __NAMESPACE__ . '\\Wallet_Domains' ) && Credential_Store::get() ) {
			if ( Wallet_Domains::ensure_after_activation() ) {
				update_option( Wallet_Domains::ENSURED_VERSION_OPTION, (string) PSC_VERSION, false );
			}
		}
	}
	public static function deactivate(): void {
		Reconciler::unschedule();
	}
	private function register(): void {
		$declare = static function (): void {
			if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
				\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', PSC_PLUGIN_FILE, true );
				\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'cart_checkout_blocks', PSC_PLUGIN_FILE, true );
			}
		};
		$declare();
		add_action( 'before_woocommerce_init', $declare );
		add_filter( 'woocommerce_payment_gateways', array( $this, 'register_classic_gateway' ) );
		add_filter( 'woocommerce_my_account_my_orders_actions', array( Gateway::class, 'filter_order_actions' ), 20, 2 );
		add_action( 'woocommerce_blocks_payment_method_type_registration', array( $this, 'register_blocks_method' ) );
		static $shared = false;
		if ( ! $shared ) {
			$shared = true;
			( new Research_Checkout() )->hooks();
			$this->legal->hooks();
			$this->settings->hooks();
			$this->rest->hooks();
			if ( ! PSC_VERIFICATION_ONLY ) {
				$this->field_policy->hooks();
				$this->reconciler->hooks();
			}
			if ( class_exists( __NAMESPACE__ . '\\Updater' ) ) {
				$updater = new Updater();
				method_exists( $updater, 'hooks' ) ? $updater->hooks() : Updater::boot();
			}
		}
	}
	public function register_classic_gateway( $gateways ) {
		$gateways[] = Gateway::class;
		return $gateways;
	}
	public function register_blocks_method( $registry ): void {
		if ( is_object( $registry ) && method_exists( $registry, 'register' ) ) {
			$registry->register( new Blocks_Payment_Method() );
		}
	}
	public function service_client(): Service_Client { return $this->service_client; }
	public function checkout_claim(): Checkout_Claim { return $this->checkout_claim; }
	public function attempt_state(): Attempt_State { return $this->attempt_state; }
	public function legal(): Legal { return $this->legal; }
	public function field_policy(): Field_Policy { return $this->field_policy; }
	public function completion(): Completion { return $this->completion; }
	public function reconciler(): Reconciler { return $this->reconciler; }
	public function refunds(): Refunds { return $this->refunds; }
	public function settings(): Settings { return $this->settings; }
}
