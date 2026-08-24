<?php

defined( 'ABSPATH' ) || exit;

final class ORBIT_Relay_Health {
    public static function payload(): array {
        return array(
            'ok'          => true,
            'service'     => 'orbit-relay',
            'woocommerce' => ORBIT_Relay::is_woocommerce_available(),
            'version'     => ORBIT_RELAY_VERSION,
        );
    }
}
