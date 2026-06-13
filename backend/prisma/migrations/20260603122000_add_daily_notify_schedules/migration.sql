-- CreateTable
CREATE TABLE `daily_notify_schedules` (
    `id` VARCHAR(191) NOT NULL,
    `base_org_id` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `interval_hours` INTEGER NOT NULL DEFAULT 3,
    `prefix` VARCHAR(191) NOT NULL DEFAULT '来自系统提醒',
    `last_triggered_slot` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `daily_notify_schedules_base_org_id_key`(`base_org_id`),
    INDEX `daily_notify_schedules_enabled_interval_hours_idx`(`enabled`, `interval_hours`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `daily_notify_schedules` ADD CONSTRAINT `daily_notify_schedules_base_org_id_fkey` FOREIGN KEY (`base_org_id`) REFERENCES `org_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
