<?php

defined( 'ABSPATH' ) || exit;

/** Stores the installation-scoped hosted-checkout secret encrypted at rest. */
final class ORBIT_Relay_Hosted_Secret_Store {
    private const OPTION = 'orbit_relay_hosted_installation_secret_encrypted';

    public static function get(): string {
        if ( defined( 'ORBIT_RELAY_HOSTED_INSTALLATION_SECRET' ) && is_string( ORBIT_RELAY_HOSTED_INSTALLATION_SECRET ) ) {
            return trim( ORBIT_RELAY_HOSTED_INSTALLATION_SECRET );
        }
        $payload = (string) get_option( self::OPTION, '' );
        return '' === $payload ? '' : self::decrypt( $payload );
    }

    public static function set( string $secret ): bool {
        if ( defined( 'ORBIT_RELAY_HOSTED_INSTALLATION_SECRET' ) ) return hash_equals( self::get(), trim( $secret ) );
        $encrypted = self::encrypt( trim( $secret ) );
        if ( '' === $encrypted ) return false;
        update_option( self::OPTION, $encrypted, false );
        return true;
    }

    private static function key(): string {
        $material = '';
        foreach ( array( 'AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY' ) as $constant ) {
            if ( defined( $constant ) ) $material .= constant( $constant );
        }
        if ( '' === $material ) $material = wp_salt( 'auth' ) . wp_salt( 'secure_auth' );
        return hash( 'sha256', 'orbit-relay-hosted|' . $material, true );
    }

    private static function encrypt( string $plaintext ): string {
        if ( '' === $plaintext ) return '';
        $key = self::key();
        if ( function_exists( 'sodium_crypto_secretbox' ) ) {
            $nonce = random_bytes( SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
            return 's1.' . base64_encode( $nonce . sodium_crypto_secretbox( $plaintext, $nonce, $key ) );
        }
        if ( function_exists( 'openssl_encrypt' ) ) {
            $iv = random_bytes( 12 );
            $tag = '';
            $cipher = openssl_encrypt( $plaintext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag );
            return false === $cipher ? '' : 'o1.' . base64_encode( $iv . $tag . $cipher );
        }
        return '';
    }

    private static function decrypt( string $payload ): string {
        $key = self::key();
        if ( str_starts_with( $payload, 's1.' ) && function_exists( 'sodium_crypto_secretbox_open' ) ) {
            $raw = base64_decode( substr( $payload, 3 ), true );
            if ( false === $raw || strlen( $raw ) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES ) return '';
            $plain = sodium_crypto_secretbox_open( substr( $raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES ), substr( $raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES ), $key );
            return false === $plain ? '' : $plain;
        }
        if ( str_starts_with( $payload, 'o1.' ) && function_exists( 'openssl_decrypt' ) ) {
            $raw = base64_decode( substr( $payload, 3 ), true );
            if ( false === $raw || strlen( $raw ) <= 28 ) return '';
            $plain = openssl_decrypt( substr( $raw, 28 ), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, substr( $raw, 0, 12 ), substr( $raw, 12, 16 ) );
            return false === $plain ? '' : $plain;
        }
        return '';
    }
}
