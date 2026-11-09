<?php
/**
 * RGVPRIME hero-driven transactional email system.
 */

defined('ABSPATH') || exit;
?>
:root {
    color-scheme: light dark !important;
    supported-color-schemes: light dark !important;
}

html,
body {
    margin: 0 !important;
    padding: 0 !important;
    min-width: 100% !important;
    background: #eeefec !important;
    background-color: #eeefec !important;
}

body,
#wrapper {
    color: #18191b !important;
    font-family: Arial, Helvetica, sans-serif !important;
}

#wrapper {
    width: 100% !important;
    max-width: 640px !important;
    margin: 0 auto !important;
    padding: 0 !important;
    text-align: left !important;
}

#wrapper table {
    box-sizing: border-box !important;
}

#template_container {
    width: 100% !important;
    max-width: 640px !important;
    margin: 0 auto !important;
    float: none !important;
    overflow: hidden !important;
    border: 1px solid #d5d5d1 !important;
    border-radius: 18px !important;
    background: #ffffff !important;
    background-color: #ffffff !important;
    box-shadow: 0 24px 60px #00000024 !important;
}

#template_header,
#header_wrapper {
    background: #090a0c !important;
    background-color: #090a0c !important;
    color: #f6f5f2 !important;
}

#header_wrapper {
    position: relative !important;
    overflow: hidden !important;
    padding: 0 38px 36px !important;
    background-image: linear-gradient(110deg, #090a0c 0%, #090a0c 68%, #421015 100%) !important;
}

.rgv-accent-line {
    position: relative !important;
    z-index: 3 !important;
    height: 4px !important;
    margin: 0 -38px 26px !important;
    overflow: hidden !important;
    background: #a93239 !important;
    color: #a93239 !important;
    font-size: 0 !important;
    line-height: 0 !important;
}

.rgv-hero-top,
.rgv-hero-copy {
    position: relative !important;
    z-index: 3 !important;
}

.rgv-logo {
    display: block !important;
    width: 142px !important;
    max-width: 142px !important;
    height: auto !important;
    border: 0 !important;
}

.rgv-order-index {
    color: #a6a7ad !important;
    font-family: Consolas, Monaco, monospace !important;
    font-size: 9px !important;
    font-weight: 700 !important;
    letter-spacing: 1.4px !important;
    line-height: 1.55 !important;
    text-transform: uppercase !important;
}

.rgv-hero-copy {
    max-width: 465px !important;
    padding-top: 40px !important;
}

.rgv-header-kicker {
    margin: 0 0 13px !important;
    color: #d05b62 !important;
    font-size: 9px !important;
    font-weight: 800 !important;
    letter-spacing: 2px !important;
    line-height: 1.4 !important;
    text-transform: uppercase !important;
}

.rgv-header-kicker span {
    display: inline-block !important;
    width: 27px !important;
    height: 1px !important;
    margin-right: 10px !important;
    background: #9d363b !important;
    color: #9d363b !important;
    vertical-align: middle !important;
}

#template_header h1 {
    max-width: 470px !important;
    margin: 0 !important;
    padding: 0 !important;
    color: #f6f5f2 !important;
    font-size: 44px !important;
    font-weight: 800 !important;
    letter-spacing: -2px !important;
    line-height: 0.99 !important;
    text-align: left !important;
    text-shadow: none !important;
}

#template_header h1 em {
    display: block !important;
    margin-top: 3px !important;
    color: #c43b43 !important;
    font-style: normal !important;
}

.rgv-hero-description {
    max-width: 425px !important;
    margin: 19px 0 0 !important;
    padding-left: 14px !important;
    border-left: 2px solid #70312d !important;
    color: #afb0b5 !important;
    font-size: 12px !important;
    line-height: 1.75 !important;
}

.rgv-hero-action {
    display: inline-block !important;
    margin-top: 22px !important;
    padding: 13px 18px !important;
    border: 1px solid #a23a40 !important;
    border-radius: 10px !important;
    background: #851e25 !important;
    background-color: #851e25 !important;
    color: #ffffff !important;
    font-size: 10px !important;
    font-weight: 800 !important;
    text-decoration: none !important;
}

.rgv-hero-action b {
    padding-left: 20px !important;
    color: #ffffff !important;
    font-size: 13px !important;
}

.rgv-hero-ribbon {
    position: absolute !important;
    z-index: 1 !important;
    top: -150px !important;
    right: -115px !important;
    width: 255px !important;
    height: 500px !important;
    overflow: hidden !important;
    border-radius: 90px !important;
    background: #68161c !important;
    background-image: linear-gradient(145deg, #4e1015 0%, #a4262f 45%, #531118 76%, #17070a 100%) !important;
    transform: rotate(26deg) !important;
}

.rgv-hero-ribbon i {
    display: block !important;
    color: transparent !important;
}

.rgv-progress-wrap {
    padding: 0 32px !important;
    background: #ffffff !important;
    background-color: #ffffff !important;
}

.rgv-email-progress {
    border-top: 1px solid #dfdfdc !important;
    border-bottom: 1px solid #dfdfdc !important;
}

.rgv-progress-step {
    padding: 15px 14px 14px !important;
}

.rgv-progress-step.has-border {
    border-left: 1px solid #dfdfdc !important;
}

.rgv-progress-step span,
.rgv-progress-step strong,
.rgv-progress-step small {
    display: block !important;
}

.rgv-progress-step span {
    margin-bottom: 7px !important;
    color: #a12d34 !important;
    font-family: Consolas, Monaco, monospace !important;
    font-size: 9px !important;
    font-weight: 800 !important;
}

.rgv-progress-step strong {
    color: #18191b !important;
    font-size: 11px !important;
    line-height: 1.35 !important;
}

.rgv-progress-step small {
    margin-top: 4px !important;
    color: #6c6d72 !important;
    font-size: 9px !important;
    line-height: 1.35 !important;
}

#template_body,
#body_content,
#body_content_inner {
    background: #ffffff !important;
    background-color: #ffffff !important;
    color: #18191b !important;
}

#body_content_inner {
    padding: 26px 32px 30px !important;
    font-size: 13px !important;
    line-height: 1.65 !important;
}

#body_content_inner p {
    margin: 0 0 14px !important;
    color: #66676c !important;
}

#body_content_inner strong {
    color: #18191b !important;
}

#body_content_inner h2,
#body_content_inner h3 {
    margin-top: 0 !important;
    color: #18191b !important;
    font-weight: 800 !important;
}

#body_content_inner h2 {
    margin-bottom: 13px !important;
    font-size: 15px !important;
    line-height: 1.35 !important;
}

.rgv-email-card {
    margin: 0 0 17px !important;
    padding: 14px !important;
    border: 1px solid #dfdfdc !important;
    border-radius: 13px !important;
    background: #f6f6f4 !important;
    background-color: #f6f6f4 !important;
}

.rgv-email-notice {
    margin: 0 0 17px !important;
    padding: 15px 16px 15px 19px !important;
    border: 1px solid #ead1d3 !important;
    border-left: 3px solid #a93239 !important;
    border-radius: 11px !important;
    background: #fff8f8 !important;
    background-color: #fff8f8 !important;
}

.rgv-email-notice strong {
    display: block !important;
    margin-bottom: 4px !important;
    color: #18191b !important;
    font-size: 11px !important;
}

.rgv-email-notice p {
    margin: 0 !important;
    color: #66676c !important;
    font-size: 10px !important;
    line-height: 1.6 !important;
}

.rgv-tracking-card .rgv-tracking-kicker {
    color: #ff5961 !important;
}

.rgv-tracking-card .rgv-tracking-title,
.rgv-tracking-card .rgv-tracking-strong {
    color: #ffffff !important;
}

.rgv-tracking-card .rgv-tracking-copy {
    color: #b8b8c0 !important;
}

.rgv-button,
.button,
a.button {
    display: inline-block !important;
    padding: 13px 19px !important;
    border: 1px solid #a23a40 !important;
    border-radius: 10px !important;
    background: #851e25 !important;
    background-color: #851e25 !important;
    color: #ffffff !important;
    font-weight: 800 !important;
    text-decoration: none !important;
}

a {
    color: #a12d34 !important;
    font-weight: 700 !important;
}

table.td,
table.shop_table {
    width: 100% !important;
    margin: 0 !important;
    overflow: hidden !important;
    border: 0 !important;
    border-radius: 10px !important;
    border-collapse: separate !important;
    border-spacing: 0 !important;
    background: transparent !important;
}

table.td th,
table.td td,
table.shop_table th,
table.shop_table td {
    padding: 10px 9px !important;
    border-color: #dfdfdc !important;
    color: #18191b !important;
    font-size: 12px !important;
    line-height: 1.45 !important;
    vertical-align: middle !important;
}

table.td th,
table.shop_table th {
    color: #4d4e52 !important;
    font-size: 10px !important;
    font-weight: 800 !important;
    letter-spacing: 0.5px !important;
    text-transform: uppercase !important;
}

table.td img,
table.shop_table img {
    width: 72px !important;
    max-width: 72px !important;
    height: 78px !important;
    margin-right: 11px !important;
    border-radius: 9px !important;
    background: #ffffff !important;
    object-fit: contain !important;
}

address {
    padding: 14px !important;
    border: 1px solid #dfdfdc !important;
    border-radius: 10px !important;
    background: #ffffff !important;
    color: #626368 !important;
    font-style: normal !important;
    line-height: 1.6 !important;
}

#template_footer {
    border-top: 1px solid #dbdbd8 !important;
    background: #efefec !important;
    background-color: #efefec !important;
}

#template_footer #credit {
    padding: 20px 32px !important;
    color: #6c6d72 !important;
    font-size: 9px !important;
    line-height: 1.6 !important;
    text-align: center !important;
}

#template_footer #credit p {
    margin: 0 !important;
}

.rgv-footer-brand {
    margin-bottom: 5px !important;
    color: #202124 !important;
    font-weight: 800 !important;
    letter-spacing: 1px !important;
}

@media only screen and (max-width: 600px) {
    #header_wrapper {
        padding: 0 22px 29px !important;
    }

    .rgv-accent-line {
        margin-right: -22px !important;
        margin-left: -22px !important;
    }

    .rgv-logo {
        width: 125px !important;
        max-width: 125px !important;
    }

    .rgv-order-index {
        font-size: 8px !important;
    }

    .rgv-hero-copy {
        padding-top: 33px !important;
    }

    #template_header h1 {
        font-size: 36px !important;
    }

    .rgv-hero-ribbon {
        right: -155px !important;
        opacity: 0.75 !important;
    }

    .rgv-progress-wrap {
        padding: 0 14px !important;
    }

    .rgv-progress-step {
        padding: 13px 7px !important;
    }

    .rgv-progress-step strong {
        font-size: 10px !important;
    }

    #body_content_inner {
        padding: 22px 15px 25px !important;
    }

    table.td th,
    table.td td,
    table.shop_table th,
    table.shop_table td {
        padding: 8px 6px !important;
        font-size: 11px !important;
    }

    #template_footer #credit {
        padding: 18px 16px !important;
    }
}

@media (prefers-color-scheme: dark) {
    html,
    body,
    .rgv-email-page,
    #wrapper {
        background: #090a0c !important;
        background-image: linear-gradient(#090a0c, #090a0c) !important;
        color: #efefed !important;
    }

    #template_container {
        border-color: #2a2b2f !important;
        background: #101114 !important;
        background-image: linear-gradient(#101114, #101114) !important;
    }

    .rgv-progress-wrap,
    #template_body,
    #body_content,
    #body_content_inner {
        background: #101114 !important;
        background-image: linear-gradient(#101114, #101114) !important;
        color: #efefed !important;
    }

    .rgv-email-progress,
    .rgv-progress-step.has-border {
        border-color: #2b2c31 !important;
    }

    .rgv-progress-step strong,
    #body_content_inner strong,
    #body_content_inner h2,
    #body_content_inner h3,
    .rgv-email-notice strong {
        color: #efefed !important;
    }

    .rgv-progress-step small,
    #body_content_inner p {
        color: #92949a !important;
    }

    .rgv-email-card {
        border-color: #303136 !important;
        background: #17181b !important;
        background-image: linear-gradient(#17181b, #17181b) !important;
    }

    .rgv-email-notice {
        border-color: #4a2629 !important;
        border-left-color: #a93239 !important;
        background: #1d1416 !important;
        background-image: linear-gradient(#1d1416, #1d1416) !important;
    }

    .rgv-email-notice p {
        color: #b6b7bc !important;
    }

    table.td th,
    table.td td,
    table.shop_table th,
    table.shop_table td {
        border-color: #34353a !important;
        color: #efefed !important;
    }

    table.td th,
    table.shop_table th {
        color: #a8a9af !important;
    }

    address {
        border-color: #34353a !important;
        background: #121316 !important;
        color: #b6b7bc !important;
    }

    #template_footer {
        border-color: #27282c !important;
        background: #0b0c0e !important;
        background-image: linear-gradient(#0b0c0e, #0b0c0e) !important;
    }

    #template_footer #credit {
        color: #777980 !important;
    }

    .rgv-footer-brand {
        color: #ededeb !important;
    }
}

[data-ogsc] body,
[data-ogsc] .rgv-email-page,
[data-ogsc] #wrapper {
    background: #090a0c !important;
    color: #efefed !important;
}

[data-ogsc] #template_container,
[data-ogsc] .rgv-progress-wrap,
[data-ogsc] #template_body,
[data-ogsc] #body_content,
[data-ogsc] #body_content_inner {
    background: #101114 !important;
    color: #efefed !important;
}
