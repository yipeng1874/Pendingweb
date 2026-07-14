-- ============================================================
-- live_room_capacities 结构升级：手动 SQL 迁移
-- 在 MySQL 客户端执行：
--   mysql -u root -p pendingweb < this_file.sql
-- ============================================================

-- 1. 创建新表 live_room_sites（如果不存在）
CREATE TABLE IF NOT EXISTS `live_room_sites` (
  `id` VARCHAR(36) NOT NULL,
  `base_org_id` VARCHAR(36) NOT NULL,
  `base_org_name` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `sort` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `live_room_sites_base_org_id_name_key` (`base_org_id`, `name`),
  INDEX `live_room_sites_base_org_id_idx` (`base_org_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. 为已有的 base_org_id 创建默认场地（从 live_room_capacities 读取）
INSERT IGNORE INTO `live_room_sites` (`id`, `base_org_id`, `base_org_name`, `name`, `sort`)
SELECT UUID(), `base_org_id`, `base_org_name`, '默认场地', 0
FROM `live_room_capacities`;

-- 3. 添加 site_details 列到 live_room_capacities
ALTER TABLE `live_room_capacities` 
ADD COLUMN `site_details` JSON NULL AFTER `base_org_name`;

-- 4. 将旧数据迁移到 site_details
UPDATE `live_room_capacities` lc
SET `site_details` = (
  SELECT JSON_ARRAY(
    JSON_OBJECT(
      'siteId', ls.id,
      'siteName', ls.name,
      'rooms', JSON_ARRAY(
        JSON_OBJECT('typeName', '直播间', 'used', lc.live_room_used, 'total', lc.total_count),
        JSON_OBJECT('typeName', '办公室', 'used', lc.office_used, 'total', lc.total_count)
      )
    )
  )
  FROM `live_room_sites` ls
  WHERE ls.base_org_id = lc.base_org_id AND ls.name = '默认场地'
);

-- 5. 确保 site_details 不为 NULL
UPDATE `live_room_capacities` SET `site_details` = JSON_ARRAY() WHERE `site_details` IS NULL;

-- 6. 修改 site_details 为 NOT NULL（因为 Prisma schema 中 Json 字段不可空）
ALTER TABLE `live_room_capacities` MODIFY COLUMN `site_details` JSON NOT NULL;

-- 7. 删除旧列
ALTER TABLE `live_room_capacities`
DROP COLUMN `total_count`,
DROP COLUMN `live_room_used`,
DROP COLUMN `office_used`;

-- 8. 重新生成 Prisma Client（完成后在 backend 目录执行）
-- npx prisma generate
