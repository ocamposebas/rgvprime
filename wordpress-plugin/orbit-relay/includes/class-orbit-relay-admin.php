<?php

defined( 'ABSPATH' ) || exit;

final class ORBIT_Relay_Admin {
    private const PAGE_SLUG = 'orbit-relay';

    public static function init(): void {
        add_action( 'admin_menu', array( __CLASS__, 'menu' ), 99 );
        add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
        add_action( 'admin_post_orbit_relay_save', array( __CLASS__, 'save' ) );
        add_action( 'admin_post_orbit_relay_regenerate_secret', array( __CLASS__, 'regenerate_secret' ) );
    }

    public static function menu(): void {
        $parent = class_exists( 'WooCommerce' ) ? 'woocommerce' : 'options-general.php';
        add_submenu_page(
            $parent,
            'ORBIT Relay',
            'ORBIT Relay',
            'manage_woocommerce',
            self::PAGE_SLUG,
            array( __CLASS__, 'render' )
        );
    }

    public static function assets( string $hook ): void {
        if ( false === strpos( $hook, self::PAGE_SLUG ) ) {
            return;
        }
        wp_enqueue_style( 'orbit-relay-admin', ORBIT_RELAY_URL . 'assets/admin.css', array(), ORBIT_RELAY_VERSION );
        wp_enqueue_script( 'orbit-relay-admin', ORBIT_RELAY_URL . 'assets/admin.js', array(), ORBIT_RELAY_VERSION, true );
    }

    public static function save(): void {
        self::guard();
        check_admin_referer( 'orbit_relay_save' );

        $api_url = isset( $_POST['orbit_relay_api_url'] ) ? esc_url_raw( wp_unslash( $_POST['orbit_relay_api_url'] ) ) : '';
        $merchant_id = isset( $_POST['orbit_relay_merchant_id'] ) ? sanitize_text_field( wp_unslash( $_POST['orbit_relay_merchant_id'] ) ) : '';
        $environment = isset( $_POST['orbit_relay_environment'] ) ? sanitize_key( wp_unslash( $_POST['orbit_relay_environment'] ) ) : 'production';

        if ( ! in_array( $environment, array( 'production', 'staging' ), true ) ) {
            $environment = 'production';
        }

        update_option( 'orbit_relay_api_url', untrailingslashit( $api_url ), false );
        update_option( 'orbit_relay_merchant_id', $merchant_id, false );
        update_option( 'orbit_relay_environment', $environment, false );
        update_option( 'orbit_relay_enabled', isset( $_POST['orbit_relay_enabled'] ) ? '1' : '0', false );
        update_option( 'orbit_relay_allow_test_payment_completion', isset( $_POST['orbit_relay_allow_test_payment_completion'] ) ? '1' : '0', false );

        ORBIT_Relay_Logger::log( 'WOO_RELAY_CONFIGURED', 'ORBIT Relay configuration updated.', array( 'merchant_id' => $merchant_id ) );
        self::redirect( 'saved' );
    }

    public static function regenerate_secret(): void {
        self::guard();
        check_admin_referer( 'orbit_relay_regenerate_secret' );

        if ( ORBIT_Relay_Secret_Store::is_external() ) {
            self::redirect( 'constant_secret' );
        }

        $secret = ORBIT_Relay::generate_secret();
        if ( ! ORBIT_Relay_Secret_Store::set( $secret ) ) {
            self::redirect( 'secret_error' );
        }

        $user_id = get_current_user_id();
        set_transient( 'orbit_relay_secret_once_' . $user_id, $secret, 120 );
        self::redirect( 'secret_regenerated' );
    }

    public static function render(): void {
        self::guard();

        $api_url      = ORBIT_Relay::api_url();
        $merchant_id  = ORBIT_Relay::merchant_id();
        $environment  = ORBIT_Relay::environment();
        $enabled      = ORBIT_Relay::enabled();
        $test_mode    = ORBIT_Relay::allow_test_payment_completion();
        $signing_secret = ORBIT_Relay::signing_secret();
        $secret_set   = '' !== $signing_secret;
        $secret_fingerprint = $secret_set ? substr( hash( 'sha256', $signing_secret ), 0, 12 ) : 'Not configured';
        $wordpress_utc = gmdate( 'c' );
        $wc_ok        = ORBIT_Relay::is_woocommerce_available();
        $configured   = $enabled && $wc_ok && '' !== $merchant_id && '' !== $api_url && $secret_set;
        $last_request = (string) get_option( 'orbit_relay_last_request_at', '' );
        $last_sync    = (string) get_option( 'orbit_relay_last_successful_sync_at', '' );
        $notice       = isset( $_GET['orbit_notice'] ) ? sanitize_key( wp_unslash( $_GET['orbit_notice'] ) ) : '';
        $one_time     = get_transient( 'orbit_relay_secret_once_' . get_current_user_id() );

        if ( $one_time ) {
            delete_transient( 'orbit_relay_secret_once_' . get_current_user_id() );
        }
        ?>
        <div class="wrap orbit-relay-wrap">
            <div class="orbit-hero">
                <div class="orbit-mark"><span></span></div>
                <div>
                    <div class="orbit-eyebrow">ORBIT INFRASTRUCTURE</div>
                    <h1>ORBIT Relay <em>· RGVPRIME</em></h1>
                    <p>Secure commerce synchronization between RGVPRIME WooCommerce and the ORBIT control plane.</p>
                </div>
            </div>

            <?php if ( 'saved' === $notice ) : ?>
                <div class="notice notice-success is-dismissible"><p>ORBIT Relay settings saved.</p></div>
            <?php elseif ( 'constant_secret' === $notice ) : ?>
                <div class="notice notice-warning is-dismissible"><p>The signing secret is controlled by ORBIT_RELAY_SIGNING_SECRET in wp-config.php and cannot be regenerated here.</p></div>
            <?php elseif ( 'secret_error' === $notice ) : ?>
                <div class="notice notice-error is-dismissible"><p>ORBIT Relay could not securely store the signing secret. Ensure Sodium or OpenSSL is available on this server.</p></div>
            <?php endif; ?>

            <?php if ( $one_time ) : ?>
                <div class="orbit-secret-once">
                    <strong>New signing secret — copy it now.</strong>
                    <p>This value is shown once and must be stored securely in ORBIT.</p>
                    <code id="orbit-new-secret"><?php echo esc_html( $one_time ); ?></code>
                    <button type="button" class="button" data-copy-target="#orbit-new-secret">Copy secret</button>
                </div>
            <?php endif; ?>

            <div class="orbit-grid orbit-grid-4">
                <?php self::status_card( 'ORBIT Connection', $configured ? 'Connected' : 'Setup required', $configured ? 'good' : 'warn' ); ?>
                <?php self::status_card( 'WooCommerce', $wc_ok ? 'Available' : 'Unavailable', $wc_ok ? 'good' : 'bad' ); ?>
                <?php self::status_card( 'Signing', $secret_set ? 'Configured' : 'Missing', $secret_set ? 'good' : 'bad' ); ?>
                <?php self::status_card( 'Environment', ucfirst( $environment ), 'neutral' ); ?>
            </div>

            <div class="orbit-panel">
                <div class="orbit-panel-head">
                    <div>
                        <span class="orbit-kicker">CONNECTION</span>
                        <h2>Relay configuration</h2>
                    </div>
                    <span class="orbit-chip <?php echo $enabled ? 'is-live' : ''; ?>"><?php echo $enabled ? 'Enabled' : 'Disabled'; ?></span>
                </div>

                <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
                    <input type="hidden" name="action" value="orbit_relay_save">
                    <?php wp_nonce_field( 'orbit_relay_save' ); ?>
                    <div class="orbit-form-grid">
                        <label>
                            <span>ORBIT API URL</span>
                            <input type="url" name="orbit_relay_api_url" value="<?php echo esc_attr( $api_url ); ?>" placeholder="https://app.your-orbit-domain.com" autocomplete="off">
                            <small>HTTPS origin of the ORBIT backend.</small>
                        </label>
                        <label>
                            <span>ORBIT Merchant ID</span>
                            <input type="text" name="orbit_relay_merchant_id" value="<?php echo esc_attr( $merchant_id ); ?>" placeholder="merchant_..." autocomplete="off">
                            <small>Canonical ORBIT merchant identifier for RGVPRIME.</small>
                        </label>
                        <label>
                            <span>Environment</span>
                            <select name="orbit_relay_environment">
                                <option value="production" <?php selected( $environment, 'production' ); ?>>Production</option>
                                <option value="staging" <?php selected( $environment, 'staging' ); ?>>Staging</option>
                            </select>
                            <small>Must match the ORBIT integration environment.</small>
                        </label>
                        <label>
                            <span>Signing secret</span>
                            <input type="text" value="<?php echo $secret_set ? '••••••••••••••••••••••••' : 'Not configured'; ?>" disabled>
                            <small>Never exposed through the REST API.</small>
                        </label>
                    </div>

                    <div class="orbit-switch-row">
                        <label class="orbit-switch">
                            <input type="checkbox" name="orbit_relay_enabled" value="1" <?php checked( $enabled ); ?>>
                            <span></span>
                            <b>Enable ORBIT Relay</b>
                        </label>
                        <label class="orbit-switch orbit-danger-switch">
                            <input type="checkbox" name="orbit_relay_allow_test_payment_completion" value="1" <?php checked( $test_mode ); ?>>
                            <span></span>
                            <b>Allow controlled test payment completion</b>
                        </label>
                    </div>
                    <p class="orbit-warning">Controlled test completion is disabled by default and applies only to signed <code>orb_test_*</code> transactions. Signed production <code>orb_tx_*</code> completions are accepted only in the Production environment after ORBIT verifies the payment.</p>

                    <div class="orbit-actions">
                        <button class="button button-primary button-hero" type="submit">Save configuration</button>
                    </div>
                </form>
            </div>

            <div class="orbit-grid orbit-grid-2">
                <div class="orbit-panel">
                    <span class="orbit-kicker">SECURITY</span>
                    <h2>Signing key</h2>
                    <p>Private requests are authenticated with HMAC-SHA256, timestamp validation and nonce replay protection.</p>
                    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" onsubmit="return confirm('Regenerate the signing secret? ORBIT requests will fail until the new secret is configured there.');">
                        <input type="hidden" name="action" value="orbit_relay_regenerate_secret">
                        <?php wp_nonce_field( 'orbit_relay_regenerate_secret' ); ?>
                        <button class="button" type="submit">Regenerate signing secret</button>
                    </form>
                </div>
                <div class="orbit-panel">
                    <span class="orbit-kicker">DIAGNOSTICS</span>
                    <h2>Operational status</h2>
                    <dl class="orbit-dl">
                        <div><dt>Merchant</dt><dd><?php echo esc_html( $merchant_id ?: 'Not configured' ); ?></dd></div>
                        <div><dt>Secret fingerprint (SHA-256)</dt><dd><code><?php echo esc_html( $secret_fingerprint ); ?></code></dd></div>
                        <div><dt>WordPress UTC</dt><dd><code><?php echo esc_html( $wordpress_utc ); ?></code></dd></div>
                        <div><dt>Last ORBIT request</dt><dd><?php echo esc_html( $last_request ?: 'Never' ); ?></dd></div>
                        <div><dt>Last successful sync</dt><dd><?php echo esc_html( $last_sync ?: 'Never' ); ?></dd></div>
                        <div><dt>Relay version</dt><dd><?php echo esc_html( ORBIT_RELAY_VERSION ); ?></dd></div>
                        <div><dt>Health endpoint</dt><dd><code><?php echo esc_html( rest_url( 'orbit/v1/health' ) ); ?></code></dd></div>
                    </dl>
                </div>
            </div>
        </div>
        <?php
    }

    private static function status_card( string $label, string $value, string $tone ): void {
        ?>
        <div class="orbit-status-card <?php echo esc_attr( 'tone-' . $tone ); ?>">
            <span><?php echo esc_html( $label ); ?></span>
            <strong><i></i><?php echo esc_html( $value ); ?></strong>
        </div>
        <?php
    }

    private static function guard(): void {
        if ( ! current_user_can( 'manage_woocommerce' ) && ! current_user_can( 'manage_options' ) ) {
            wp_die( esc_html__( 'You do not have permission to manage ORBIT Relay.', 'orbit-relay' ) );
        }
    }

    private static function redirect( string $notice ): void {
        wp_safe_redirect( add_query_arg( array( 'page' => self::PAGE_SLUG, 'orbit_notice' => $notice ), admin_url( 'admin.php' ) ) );
        exit;
    }
}
