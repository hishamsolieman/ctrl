-- =============================================================================
-- CTRL — Database schema + seed data
-- The tables are created by SQLAlchemy models (authoritative), and this file's
-- INSERTs are executed by database/init_db.py to seed data. It is also valid to
-- run this whole file directly (e.g. `mysql < database/db.sql`).
-- Charset utf8mb4 is required for full i18n (Arabic, emoji, etc.).
-- =============================================================================

CREATE DATABASE IF NOT EXISTS `ctrl`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `ctrl`;

-- Roles: Cashier < Moderator < Admin < SuperAdmin ----------------------------
CREATE TABLE IF NOT EXISTS `roles` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `name`        VARCHAR(50)  NOT NULL UNIQUE,
  `level`       INT          NOT NULL DEFAULT 0,
  `description` VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Users: username + bcrypt password hash --------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id`            INT AUTO_INCREMENT PRIMARY KEY,
  `username`      VARCHAR(100) NOT NULL UNIQUE,
  `full_name`     VARCHAR(150) NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `is_active`     TINYINT(1)   NOT NULL DEFAULT 1,
  `locale`        VARCHAR(10)  NOT NULL DEFAULT 'en',
  `role_id`       INT          NOT NULL,
  `created_at`    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Action logs: every meaningful action ---------------------------------------
CREATE TABLE IF NOT EXISTS `action_logs` (
  `id`         INT AUTO_INCREMENT PRIMARY KEY,
  `user_id`    INT          NULL,
  `action`     VARCHAR(100) NOT NULL,
  `entity`     VARCHAR(100) NULL,
  `entity_id`  VARCHAR(100) NULL,
  `details`    TEXT         NULL,
  `status`     VARCHAR(20)  NOT NULL DEFAULT 'success',
  `ip_address` VARCHAR(64)  NULL,
  `user_agent` VARCHAR(255) NULL,
  `created_at` DATETIME     DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_logs_user` (`user_id`),
  KEY `idx_logs_action` (`action`),
  KEY `idx_logs_created` (`created_at`),
  CONSTRAINT `fk_logs_user` FOREIGN KEY (`user_id`)
    REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Translations: backend-managed i18n (en, ar, + future locales) ---------------
CREATE TABLE IF NOT EXISTS `translations` (
  `id`        INT AUTO_INCREMENT PRIMARY KEY,
  `namespace` VARCHAR(100) NOT NULL DEFAULT 'common',
  `key`       VARCHAR(150) NOT NULL,
  `locale`    VARCHAR(10)  NOT NULL,
  `value`     TEXT         NOT NULL,
  UNIQUE KEY `uq_translation` (`namespace`, `key`, `locale`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Settings: DB-configurable app settings (brand, currency, ...) ---------------
CREATE TABLE IF NOT EXISTS `settings` (
  `key`   VARCHAR(100) PRIMARY KEY,
  `value` TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Categories: bilingual (en/ar), extensible to more locales -------------------
CREATE TABLE IF NOT EXISTS `categories` (
  `id`        INT AUTO_INCREMENT PRIMARY KEY,
  `name_en`   VARCHAR(120) NOT NULL,
  `name_ar`   VARCHAR(120) NOT NULL,
  `is_active` TINYINT(1)   NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Suppliers -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `suppliers` (
  `id`        INT AUTO_INCREMENT PRIMARY KEY,
  `name`      VARCHAR(180) NOT NULL,
  `phone`     VARCHAR(60)  NULL,
  `email`     VARCHAR(180) NULL,
  `is_active` TINYINT(1)   NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Attribute definitions (Color, Size, ...) -----------------------------------
CREATE TABLE IF NOT EXISTS `attributes` (
  `id`         INT AUTO_INCREMENT PRIMARY KEY,
  `key`        VARCHAR(60)  NOT NULL UNIQUE,
  `name_en`    VARCHAR(120) NOT NULL,
  `name_ar`    VARCHAR(120) NOT NULL,
  `sort_order` INT DEFAULT 0,
  `is_active`  TINYINT(1)   NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `attribute_values` (
  `id`           INT AUTO_INCREMENT PRIMARY KEY,
  `attribute_id` INT NOT NULL,
  `value_en`     VARCHAR(120) NOT NULL,
  `value_ar`     VARCHAR(120) NOT NULL,
  `extra`        JSON NULL,
  `sort_order`   INT DEFAULT 0,
  KEY `idx_attrval_attr` (`attribute_id`),
  CONSTRAINT `fk_attrval_attr` FOREIGN KEY (`attribute_id`)
    REFERENCES `attributes`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Products (shared info) ------------------------------------------------------
-- Prices are float. `tags` is JSON. Deletion is a SOFT delete.
CREATE TABLE IF NOT EXISTS `products` (
  `id`                INT AUTO_INCREMENT PRIMARY KEY,
  `name`              VARCHAR(255) NOT NULL,
  `description`       TEXT         NULL,
  `category_id`       INT          NULL,
  `supplier_id`       INT          NULL,
  `supplier_price`    DOUBLE       DEFAULT 0,
  `min_price`         DOUBLE       DEFAULT 0,
  `price`             DOUBLE       DEFAULT 0,
  `note`              TEXT         NULL,
  `tags`              JSON         NULL,
  `is_deleted`        TINYINT(1)   NOT NULL DEFAULT 0,
  `deleted_at`        DATETIME     NULL,
  `created_at`        DATETIME     DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_products_deleted` (`is_deleted`),
  CONSTRAINT `fk_products_category` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`),
  CONSTRAINT `fk_products_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Product variants (size/colour combos): unique code + own images -------------
-- `attributes` is JSON {attribute_id: attribute_value_id}.
CREATE TABLE IF NOT EXISTS `product_variants` (
  `id`         INT AUTO_INCREMENT PRIMARY KEY,
  `product_id` INT NOT NULL,
  `code`       VARCHAR(32) NOT NULL UNIQUE,
  `attributes` JSON NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `deleted_at` DATETIME NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_variant_product` (`product_id`),
  KEY `idx_variant_code` (`code`),
  CONSTRAINT `fk_variant_product` FOREIGN KEY (`product_id`)
    REFERENCES `products`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Product images (up to 5 per variant) ----------------------------------------
CREATE TABLE IF NOT EXISTS `product_images` (
  `id`         INT AUTO_INCREMENT PRIMARY KEY,
  `variant_id` INT NOT NULL,
  `url`        VARCHAR(512) NOT NULL,
  `sort_order` INT DEFAULT 0,
  KEY `idx_pimg_variant` (`variant_id`),
  CONSTRAINT `fk_pimg_variant` FOREIGN KEY (`variant_id`)
    REFERENCES `product_variants`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================ SEED DATA ======================================

-- Roles -----------------------------------------------------------------------
INSERT IGNORE INTO `roles` (`name`, `level`, `description`) VALUES
  ('Cashier',    10, 'Operates the point of sale.'),
  ('Moderator',  20, 'Manages catalog and day-to-day operations.'),
  ('Admin',      30, 'Full administrative access to the store.'),
  ('SuperAdmin', 40, 'Unrestricted, top-level system access.');

-- Seed SuperAdmin -------------------------------------------------------------
-- Username: admin   Password: Oselfasads@eshta
-- password_hash below is a bcrypt hash of the password above (never stored plaintext).
INSERT IGNORE INTO `users`
  (`username`, `full_name`, `password_hash`, `is_active`, `locale`, `role_id`)
SELECT
  'admin',
  'Super Administrator',
  '$2b$12$slP5XmthecGFOY.ZPiwD0.Qh4haYvwOxm9Ygm/g/vXyPbl5bMqVre',
  1,
  'en',
  r.`id`
FROM `roles` r
WHERE r.`name` = 'SuperAdmin';

-- Brand + currency (configurable in the database) -----------------------------
INSERT IGNORE INTO `settings` (`key`, `value`) VALUES
  ('brand_name',  'CTRL'),
  ('brand_motto', 'Stay in CTRL.'),
  ('currency',    'EGP');

-- Categories (bilingual) ------------------------------------------------------
INSERT IGNORE INTO `categories` (`id`, `name_en`, `name_ar`, `is_active`) VALUES
  (1, 'T-Shirt', 'تي شيرت', 1),
  (2, 'Shirt',   'قميص',    1),
  (3, 'Pants',   'بنطلون',  1);

-- Suppliers -------------------------------------------------------------------
INSERT IGNORE INTO `suppliers` (`id`, `name`, `phone`, `email`, `is_active`) VALUES
  (1, 'Default Supplier', NULL, NULL, 1),
  (2, 'Cairo Textiles',   NULL, NULL, 1);

-- Attribute definitions (Color, Size) + bilingual values ----------------------
INSERT IGNORE INTO `attributes` (`id`, `key`, `name_en`, `name_ar`, `sort_order`, `is_active`) VALUES
  (1, 'color', 'Color', 'اللون',   1, 1),
  (2, 'size',  'Size',  'المقاس', 2, 1);

INSERT IGNORE INTO `attribute_values` (`id`, `attribute_id`, `value_en`, `value_ar`, `extra`, `sort_order`) VALUES
  (1, 1, 'Red',   'أحمر', '{"hex": "#dc2626"}', 1),
  (2, 1, 'Blue',  'أزرق', '{"hex": "#2563eb"}', 2),
  (3, 1, 'Black', 'أسود', '{"hex": "#111111"}', 3),
  (4, 1, 'White', 'أبيض', '{"hex": "#f5f5f5"}', 4),
  (5, 1, 'Green', 'أخضر', '{"hex": "#16a34a"}', 5),
  (6, 2, 'S',  'صغير',       NULL, 1),
  (7, 2, 'M',  'وسط',        NULL, 2),
  (8, 2, 'L',  'كبير',       NULL, 3),
  (9, 2, 'XL', 'كبير جدًا',  NULL, 4);

-- Starter translations (en + ar) ---------------------------------------------
INSERT IGNORE INTO `translations` (`namespace`, `key`, `locale`, `value`) VALUES
  ('common', 'welcome', 'en', 'Welcome'),
  ('common', 'welcome', 'ar', 'مرحبا');
