<?php
/**
 * Plugin Name: RGV Google Login Bridge
 * Description: Links verified Google identities to existing RGVPRIME WordPress customers and reuses the Customer Portal session.
 * Version: 1.0.0
 * Author: RGVPRIME LLC
 * Requires at least: 6.4
 * Requires PHP: 7.4
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'RGVGL_VERSION', '1.0.0' );
define( 'RGVGL_GOOGLE_SUB_META', '_rgvp_google_sub' );
define( 'RGVGL_GOOGLE_LINKED_AT_META', '_rgvp_google_linked_at' );

add_action(
    'rest_api_init',
    static function (): void {
        register_rest_route(
            defined( 'RGVP_NAMESPACE' ) ? RGVP_NAMESPACE : 'rgv-portal/v1',
            '/google-login',
            array(
                'methods'             => 'POST',
                'callback'            => 'rgvgl_google_login',
                'permission_callback' => 'rgvgl_secret_permission',
            )
        );
    },
    20
);

add_action(
    'admin_notices',
    static function (): void {
        if ( function_exists( 'rgvp_create_session' ) ) {
            return;
        }

        echo '<div class="notice notice-error"><p>';
        echo esc_html__(
            'RGV Google Login Bridge requires the RGV Customer Portal API plugin to be active.',
            'rgv-google-login'
        );
        echo '</p></div>';
    }
);

/**
 * Reuse the portal plugin permission check. The fallback supports the secret
 * names used by both the current production portal and older local copies.
 *
 * @return true|WP_Error
 */
function rgvgl_secret_permission( WP_REST_Request $request ) {
    if ( function_exists( 'rgvp_secret_permission' ) ) {
        return rgvp_secret_permission( $request );
    }

    $secret = '';

    foreach ( array( 'RGV_PORTAL_API_SECRET', 'RGV_PORTAL_SECRET' ) as $constant ) {
        if ( defined( $constant ) && constant( $constant ) ) {
            $secret = trim( (string) constant( $constant ) );
            break;
        }
    }

    if ( ! $secret ) {
        $secret = trim( (string) getenv( 'PORTAL_API_SECRET' ) );
    }

    $incoming = trim( (string) $request->get_header( 'x-rgv-portal-secret' ) );

    if ( ! $secret ) {
        return new WP_Error(
            'rgvgl_secret_missing',
            'Portal secret is not configured.',
            array( 'status' => 500 )
        );
    }

    if ( ! $incoming || ! hash_equals( $secret, $incoming ) ) {
        return new WP_Error(
            'rgvgl_forbidden',
            'Forbidden.',
            array( 'status' => 403 )
        );
    }

    return true;
}

/**
 * @return WP_REST_Response
 */
function rgvgl_response( array $data, int $status = 200 ) {
    if ( function_exists( 'rgvp_response' ) ) {
        return rgvp_response( $data, $status );
    }

    return new WP_REST_Response( $data, $status );
}

/**
 * @return WP_Error
 */
function rgvgl_error( string $message, int $status = 400, string $code = 'rgvgl_error' ) {
    if ( function_exists( 'rgvp_error' ) ) {
        return rgvp_error( $message, $status, $code );
    }

    return new WP_Error( $code, $message, array( 'status' => $status ) );
}

/**
 * @return WP_User[]
 */
function rgvgl_users_for_google_subject( string $subject ): array {
    $users = get_users(
        array(
            'meta_key'   => RGVGL_GOOGLE_SUB_META,
            'meta_value' => $subject,
            'number'     => 2,
            'orderby'    => 'ID',
            'order'      => 'ASC',
        )
    );

    return is_array( $users ) ? $users : array();
}

function rgvgl_unique_username( string $email ): string {
    if ( function_exists( 'rgvp_create_username' ) ) {
        return rgvp_create_username( $email );
    }

    $parts = explode( '@', $email );
    $base  = sanitize_user( (string) reset( $parts ), true );
    $base  = $base ?: 'customer';
    $name  = $base;
    $index = 1;

    while ( username_exists( $name ) ) {
        $name = $base . $index;
        ++$index;
    }

    return $name;
}

function rgvgl_fill_empty_customer_names(
    WP_User $user,
    string $first_name,
    string $last_name,
    string $display_name
): void {
    $updates = array( 'ID' => $user->ID );
    $dirty   = false;

    if ( ! get_user_meta( $user->ID, 'first_name', true ) && $first_name ) {
        $updates['first_name'] = $first_name;
        $dirty                 = true;
    }

    if ( ! get_user_meta( $user->ID, 'last_name', true ) && $last_name ) {
        $updates['last_name'] = $last_name;
        $dirty                = true;
    }

    if ( ! trim( (string) $user->display_name ) && $display_name ) {
        $updates['display_name'] = $display_name;
        $dirty                   = true;
    }

    if ( $dirty ) {
        wp_update_user( $updates );
    }

    if ( ! get_user_meta( $user->ID, 'billing_email', true ) ) {
        update_user_meta( $user->ID, 'billing_email', $user->user_email );
    }

    if ( ! get_user_meta( $user->ID, 'billing_first_name', true ) && $first_name ) {
        update_user_meta( $user->ID, 'billing_first_name', $first_name );
    }

    if ( ! get_user_meta( $user->ID, 'billing_last_name', true ) && $last_name ) {
        update_user_meta( $user->ID, 'billing_last_name', $last_name );
    }
}

/**
 * The Astro server verifies Google's signature, issuer, expiry, audience, and
 * verified-email claim before forwarding these identity fields. This route is
 * additionally protected by the private portal secret.
 *
 * @return WP_REST_Response|WP_Error
 */
function rgvgl_google_login( WP_REST_Request $request ) {
    if (
        ! function_exists( 'rgvp_create_session' ) ||
        ! function_exists( 'rgvp_user_payload' ) ||
        ! function_exists( 'rgvp_get_orders_for_user' )
    ) {
        return rgvgl_error(
            'The customer portal session service is unavailable.',
            503,
            'rgvgl_portal_unavailable'
        );
    }

    $raw_subject = trim( (string) $request->get_param( 'google_sub' ) );
    $subject     = preg_replace( '/[^A-Za-z0-9_-]/', '', $raw_subject );
    $email       = sanitize_email( strtolower( trim( (string) $request->get_param( 'email' ) ) ) );
    $verified    = rest_sanitize_boolean( $request->get_param( 'email_verified' ) );
    $first_name  = sanitize_text_field( (string) $request->get_param( 'first_name' ) );
    $last_name   = sanitize_text_field( (string) $request->get_param( 'last_name' ) );
    $display     = sanitize_text_field( (string) $request->get_param( 'display_name' ) );

    if (
        ! $subject ||
        $subject !== $raw_subject ||
        strlen( $subject ) > 255 ||
        ! $verified ||
        ! is_email( $email )
    ) {
        return rgvgl_error(
            'Google identity data is invalid.',
            422,
            'rgvgl_invalid_identity'
        );
    }

    $linked_users = rgvgl_users_for_google_subject( $subject );

    if ( count( $linked_users ) > 1 ) {
        return rgvgl_error(
            'This Google identity needs account support before it can sign in.',
            409,
            'rgvgl_duplicate_link'
        );
    }

    $user            = $linked_users ? reset( $linked_users ) : false;
    $created         = false;
    $linked_existing = false;

    if ( ! $user ) {
        $user = get_user_by( 'email', $email );

        if ( $user ) {
            $current_subject = trim(
                (string) get_user_meta( $user->ID, RGVGL_GOOGLE_SUB_META, true )
            );

            if ( $current_subject && ! hash_equals( $current_subject, $subject ) ) {
                return rgvgl_error(
                    'This WordPress account is already linked to another Google identity. Contact support for help.',
                    409,
                    'rgvgl_account_already_linked'
                );
            }

            $linked_existing = true;
        } else {
            $user_id = wp_insert_user(
                array(
                    'user_login'   => rgvgl_unique_username( $email ),
                    'user_pass'    => wp_generate_password( 32, true, true ),
                    'user_email'   => $email,
                    'first_name'   => $first_name,
                    'last_name'    => $last_name,
                    'display_name' => $display ?: trim( $first_name . ' ' . $last_name ),
                    'role'         => 'customer',
                )
            );

            if ( is_wp_error( $user_id ) ) {
                if ( 'existing_user_email' === $user_id->get_error_code() ) {
                    $user = get_user_by( 'email', $email );
                }

                if ( ! $user ) {
                    return rgvgl_error(
                        $user_id->get_error_message(),
                        400,
                        'rgvgl_create_failed'
                    );
                }

                $linked_existing = true;
            } else {
                $user    = get_user_by( 'id', $user_id );
                $created = true;
            }
        }

        $current_subject = trim(
            (string) get_user_meta( $user->ID, RGVGL_GOOGLE_SUB_META, true )
        );

        if ( $current_subject && ! hash_equals( $current_subject, $subject ) ) {
            return rgvgl_error(
                'This WordPress account is already linked to another Google identity. Contact support for help.',
                409,
                'rgvgl_account_already_linked'
            );
        }

        update_user_meta( $user->ID, RGVGL_GOOGLE_SUB_META, $subject );
        update_user_meta( $user->ID, RGVGL_GOOGLE_LINKED_AT_META, gmdate( 'c' ) );
    }

    rgvgl_fill_empty_customer_names(
        $user,
        $first_name,
        $last_name,
        $display ?: trim( $first_name . ' ' . $last_name )
    );

    $fresh_user = get_user_by( 'id', $user->ID );
    $session    = rgvp_create_session( $fresh_user->ID );

    do_action(
        'rgvgl_google_login',
        $fresh_user->ID,
        array(
            'created'         => $created,
            'linked_existing' => $linked_existing,
        )
    );

    return rgvgl_response(
        array(
            'success'         => true,
            'token'           => $session['token'],
            'expires'         => $session['expires'],
            'user'            => rgvp_user_payload( $fresh_user ),
            'orders'          => rgvp_get_orders_for_user( $fresh_user->ID ),
            'created'         => $created,
            'linked_existing' => $linked_existing,
        )
    );
}
