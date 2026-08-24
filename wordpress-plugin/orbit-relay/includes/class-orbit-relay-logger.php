<?php

defined( 'ABSPATH' ) || exit;

final class ORBIT_Relay_Logger {
    public static function log( string $event, string $message = '', array $context = array(), string $level = 'info' ): void {
        $safe = self::redact( $context );
        $line = trim( $event . ( $message ? ' · ' . $message : '' ) );

        if ( function_exists( 'wc_get_logger' ) ) {
            $logger = wc_get_logger();
            if ( method_exists( $logger, $level ) ) {
                $logger->{$level}( $line, array( 'source' => 'orbit-relay', 'context' => $safe ) );
                return;
            }
            $logger->info( $line, array( 'source' => 'orbit-relay', 'context' => $safe ) );
            return;
        }

        if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
            error_log( '[ORBIT Relay] ' . $line ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
        }
    }

    private static function redact( array $context ): array {
        $blocked = array( 'secret', 'signature', 'authorization', 'api_key', 'stripe', 'card', 'cvc', 'pan' );
        foreach ( $context as $key => $value ) {
            $lower = strtolower( (string) $key );
            foreach ( $blocked as $needle ) {
                if ( str_contains( $lower, $needle ) ) {
                    $context[ $key ] = '[REDACTED]';
                    continue 2;
                }
            }
        }
        return $context;
    }
}
