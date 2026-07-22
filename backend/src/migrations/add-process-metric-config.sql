-- ============================================================
-- process_metric_configs：过程指标参与团队配置（按基地维度共享）
-- 在 MySQL 客户端执行：
--   mysql -u root -p pendingweb < this_file.sql
-- 或通过 Prisma migrate 自动执行
-- ============================================================

CREATE TABLE IF NOT EXISTS `process_metric_configs` (
  `base_org_id` VARCHAR(36) NOT NULL,
  `team_ids`   TEXT NOT NULL COMMENT 'JSON 数组，如 ["id1","id2"]',
  `updated_by` VARCHAR(36) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`base_org_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
