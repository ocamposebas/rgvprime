<?php
/**
 * ORBIT Relay intentionally preserves configuration and reconciliation metadata on uninstall.
 * Financial/audit history must never be silently destroyed.
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;
