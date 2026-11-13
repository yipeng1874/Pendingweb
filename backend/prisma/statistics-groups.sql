-- Additive only: no task, organization or historical data is modified.
CREATE TABLE IF NOT EXISTS organization_statistics_groups (
  base_org_id VARCHAR(191) NOT NULL PRIMARY KEY,
  groups_json JSON NOT NULL,
  revision INT NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
