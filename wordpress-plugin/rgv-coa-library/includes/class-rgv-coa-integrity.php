<?php

defined('ABSPATH') || exit;

final class RGV_COA_Integrity {
    public static function valid_purity($value) {
        return (bool) preg_match('/^(?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)%$/', trim((string) $value));
    }

    public static function valid_date($value) {
        $value = trim((string) $value);
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        return $date && $date->format('Y-m-d') === $value;
    }

    public static function valid_sample_id($value) {
        return (bool) preg_match('/^(?:ACC-[A-Z0-9-]+|\d{8,})$/i', trim((string) $value));
    }

    public static function normalize($value) {
        $value = remove_accents(strtolower(trim((string) $value)));
        $value = preg_replace('/[^a-z0-9]+/', ' ', $value);
        return trim(preg_replace('/\s+/', ' ', $value));
    }

    public static function remove_analyte_aliases($aliases, $analytes) {
        $analyte_names = [];
        foreach ((array) $analytes as $analyte) {
            $name = is_array($analyte) ? ($analyte['name'] ?? '') : $analyte;
            $normalized = self::normalize($name);
            if ($normalized) {
                $analyte_names[$normalized] = true;
            }
        }

        return array_values(array_filter(array_map('sanitize_text_field', (array) $aliases), function ($alias) use ($analyte_names) {
            return $alias && empty($analyte_names[self::normalize($alias)]);
        }));
    }

    public static function validate_record($record) {
        $issues = [];
        if (!empty($record['purity']) && !self::valid_purity($record['purity'])) {
            $issues[] = ['code' => 'invalid_purity', 'field' => 'purity'];
        }
        if (!empty($record['sample_id']) && !self::valid_sample_id($record['sample_id'])) {
            $issues[] = ['code' => 'malformed_sample_id', 'field' => 'sample_id'];
        }
        foreach (['received_date', 'test_date', 'report_date'] as $field) {
            if (!empty($record[$field]) && !self::valid_date($record[$field])) {
                $issues[] = ['code' => 'invalid_date', 'field' => $field];
            }
        }
        return $issues;
    }
}
