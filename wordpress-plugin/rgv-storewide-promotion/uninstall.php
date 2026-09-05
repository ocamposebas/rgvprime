<?php
/**
 * Uninstall cleanup.
 *
 * @package RGV_Storewide_Promotion
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_option( 'rgv_storewide_promotion' );

