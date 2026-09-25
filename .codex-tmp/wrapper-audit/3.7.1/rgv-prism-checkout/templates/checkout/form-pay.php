<?php
/**
 * RGVPRIME pay-for-order form.
 *
 * Keeps WooCommerce's canonical order-pay fields and hooks while providing a
 * stable layout for the signed storefront payment handoff.
 *
 * @package RGVPRIME
 * @version 10.9.0
 */

defined('ABSPATH') || exit;

$totals = $order->get_order_item_totals(); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
$items = $order->get_items();
$item_count = count($items);
?>
<form id="order_review" class="rgv-order-pay" method="post">
  <table class="shop_table rgv-order-summary">
    <caption class="rgv-order-summary__caption">
      <span class="rgv-order-summary__heading">
        <small><?php esc_html_e('Your order', 'woocommerce'); ?></small>
        <strong><?php esc_html_e('Order summary', 'woocommerce'); ?></strong>
      </span>
      <span class="rgv-order-summary__count">
        <?php
        echo esc_html(
          sprintf(
            /* translators: %d: number of products in the order. */
            _n('%d item', '%d items', $item_count, 'woocommerce'),
            $item_count
          )
        );
        ?>
      </span>
    </caption>
    <thead>
      <tr>
        <th class="product-name"><?php esc_html_e('Product', 'woocommerce'); ?></th>
        <th class="product-quantity"><?php esc_html_e('Qty', 'woocommerce'); ?></th>
        <th class="product-total"><?php esc_html_e('Totals', 'woocommerce'); ?></th>
      </tr>
    </thead>
    <tbody>
      <?php if ($item_count > 0) : ?>
        <?php $line_number = 0; ?>
        <?php foreach ($items as $item_id => $item) : ?>
          <?php
          if (!apply_filters('woocommerce_order_item_visible', true, $item)) {
            continue;
          }
          $line_number++;
          ?>
          <tr class="<?php echo esc_attr(apply_filters('woocommerce_order_item_class', 'order_item rgv-order-summary__product', $item, $order)); ?>">
            <td class="product-name" data-rgv-line="<?php echo esc_attr(str_pad((string) $line_number, 2, '0', STR_PAD_LEFT)); ?>">
              <?php
              echo wp_kses_post(apply_filters('woocommerce_order_item_name', $item->get_name(), $item, false));
              do_action('woocommerce_order_item_meta_start', $item_id, $item, $order, false);
              wc_display_item_meta($item);
              do_action('woocommerce_order_item_meta_end', $item_id, $item, $order, false);
              ?>
            </td>
            <td class="product-quantity">
              <?php
              echo apply_filters(
                'woocommerce_order_item_quantity_html',
                '<strong class="product-quantity">' . sprintf('&times;&nbsp;%s', esc_html($item->get_quantity())) . '</strong>',
                $item
              ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
              ?>
            </td>
            <td class="product-subtotal"><?php echo $order->get_formatted_line_subtotal($item); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></td>
          </tr>
        <?php endforeach; ?>
      <?php endif; ?>
    </tbody>
    <tfoot>
      <?php if ($totals) : ?>
        <?php foreach ($totals as $total_key => $total) : ?>
          <?php
          $row_classes = ['rgv-order-summary__row', 'rgv-order-summary__row--' . sanitize_html_class((string) $total_key)];
          if ('payment_method' === $total_key) {
            $row_classes[] = 'rgv-order-summary__method';
          }
          if ('order_total' === $total_key) {
            $row_classes[] = 'rgv-order-summary__total';
          }
          ?>
          <tr class="<?php echo esc_attr(implode(' ', $row_classes)); ?>">
            <th scope="row" colspan="2"><?php echo $total['label']; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></th>
            <td class="product-total"><?php echo $total['value']; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></td>
          </tr>
        <?php endforeach; ?>
      <?php endif; ?>
    </tfoot>
  </table>

  <section class="rgv-payment-card__header" aria-labelledby="rgv-card-title">
    <span class="rgv-payment-card__icon" aria-hidden="true"></span>
    <div class="rgv-payment-card__heading">
      <small>Payment</small>
      <h2 id="rgv-card-title">Card details</h2>
      <p>Enter your card information to complete the order.</p>
    </div>
    <span class="rgv-payment-card__step">Step 2 of 2</span>
  </section>

  <?php
  /**
   * Triggered immediately before the payment section.
   *
   * The payment provider uses this hook and then mounts its secure iframe.
   *
   * @since 8.2.0
   */
  do_action('woocommerce_pay_order_before_payment');
  ?>

  <div id="payment" class="rgv-payment-card">
    <?php if ($order->needs_payment()) : ?>
      <ul class="wc_payment_methods payment_methods methods" aria-label="<?php esc_attr_e('Payment methods', 'woocommerce'); ?>">
        <?php
        if (!empty($available_gateways)) {
          foreach ($available_gateways as $gateway) {
            wc_get_template('checkout/payment-method.php', ['gateway' => $gateway]);
          }
        } else {
          echo '<li>';
          wc_print_notice(
            apply_filters(
              'woocommerce_no_available_payment_methods_message',
              esc_html__('Sorry, there are no available payment methods for your location. Please contact us for assistance.', 'woocommerce')
            ),
            'notice'
          );
          echo '</li>';
        }
        ?>
      </ul>
    <?php endif; ?>

    <div class="form-row place-order">
      <input type="hidden" name="woocommerce_pay" value="1" />
      <?php wc_get_template('checkout/terms.php'); ?>

      <?php do_action('woocommerce_pay_order_before_submit'); ?>
      <?php
      echo apply_filters(
        'woocommerce_pay_order_button_html',
        '<button type="submit" class="button alt' . esc_attr(wc_wp_theme_get_element_class_name('button') ? ' ' . wc_wp_theme_get_element_class_name('button') : '') . '" id="place_order" value="' . esc_attr($order_button_text) . '" data-value="' . esc_attr($order_button_text) . '">' . esc_html($order_button_text) . '</button>'
      ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
      ?>

      <?php do_action('woocommerce_pay_order_after_submit'); ?>
      <?php wp_nonce_field('woocommerce-pay', 'woocommerce-pay-nonce'); ?>
    </div>
  </div>
</form>
