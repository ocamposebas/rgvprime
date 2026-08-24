<?php

defined( 'ABSPATH' ) || exit;

final class ORBIT_Relay_Secret_Store {
    private const OPTION = 'orbit_relay_signing_secret_encrypted';

    public static function get(): string {
        if ( defined( 'ORBIT_RELAY_SIGNING_SECRET' ) && is_string( ORBIT_RELAY_SIGNING_SECRET ) && '' !== ORBIT_RELAY_SIGNING_SECRET ) {
            return ORBIT_RELAY_SIGNING_SECRET;
        }

        $payload = (string) get_option( self::OPTION, '' );
        if ( '' !== $payload ) {
            $secret = self::decrypt( $payload );
            if ( '' !== $secret ) {
                return $secret;
            }
        }

        $legacy = (string) get_option( 'orbit_relay_signing_secret', '' );
        if ( '' !== $legacy ) {
            self::set( $legacy );
            delete_option( 'orbit_relay_signing_secret' );
            return $legacy;
        }

        return '';
    }

    public static function set( string $secret ): bool {
        if ( defined( 'ORBIT_RELAY_SIGNING_SECRET' ) ) {
            return false;
        }

        $encrypted = self::encrypt( $secret );
        if ( '' === $encrypted ) {
            return false;
        }

        update_option( self::OPTION, $encrypted, false );
        delete_option( 'orbit_relay_signing_secret' );
        return true;
    }

    public static function is_external(): bool {
        return defined( 'ORBIT_RELAY_SIGNING_SECRET' );
    }

    private static function encryption_key(): string {
        $material = '';
        foreach ( array( 'AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY' ) as $constant ) {
            if ( defined( $constant ) ) {
                $material .= constant( $constant );
            }
        }
        if ( '' === $material ) {
            $material = wp_salt( 'auth' ) . wp_salt( 'secure_auth' );
        }
        return hash( 'sha256', 'orbit-relay|' . $material, true );
    }

    private static function encrypt( string $plaintext ): string {
        if ( '' === $plaintext ) {
            return '';
        }

        $key = self::encryption_key();

        if ( function_exists( 'sodium_crypto_secretbox' ) ) {
            $nonce = random_bytes( SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
            $cipher = sodium_crypto_secretbox( $plaintext, $nonce, $key );
            return 's1.' . base64_encode( $nonce . $cipher );
        }

        if ( function_exists( 'openssl_encrypt' ) ) {
            $iv = random_bytes( 12 );
            $tag = '';
            $cipher = openssl_encrypt( $plaintext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag );
            if ( false === $cipher ) {
                return '';
            }
            return 'o1.' . base64_encode( $iv . $tag . $cipher );
        }

        return '';
    }

    private static function decrypt( string $payload ): string {
        $key = self::encryption_key();

        if ( str_starts_with( $payload, 's1.' ) && function_exists( 'sodium_crypto_secretbox_open' ) ) {
            $raw = base64_decode( substr( $payload, 3 ), true );
            if ( false === $raw || strlen( $raw ) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES ) {
                return '';
            }
            $nonce = substr( $raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
            $cipher = substr( $raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
            $plain = sodium_crypto_secretbox_open( $cipher, $nonce, $key );
            return false === $plain ? '' : $plain;
        }

        if ( str_starts_with( $payload, 'o1.' ) && function_exists( 'openssl_decrypt' ) ) {
            $raw = base64_decode( substr( $payload, 3 ), true );
            if ( false === $raw || strlen( $raw ) <= 28 ) {
                return '';
            }
            $iv = substr( $raw, 0, 12 );
            $tag = substr( $raw, 12, 16 );
            $cipher = substr( $raw, 28 );
            $plain = openssl_decrypt( $cipher, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag );
            return false === $plain ? '' : $plain;
        }

        return '';
    }
}
