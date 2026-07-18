-- AlterTable
ALTER TABLE `task_assignments` ADD COLUMN `pre_deadline_confirm_enabled` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `task_records` ADD COLUMN `reconfirm_status` VARCHAR(191) NULL,
                           ADD COLUMN `reconfirm_sent_at` DATETIME(3) NULL,
                           ADD COLUMN `reconfirm_confirmed_at` DATETIME(3) NULL;
