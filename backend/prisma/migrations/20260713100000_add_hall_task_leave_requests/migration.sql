-- CreateTable
CREATE TABLE `hall_task_leave_requests` (
    `id` VARCHAR(191) NOT NULL,
    `task_record_id` VARCHAR(191) NOT NULL,
    `applicant_user_id` VARCHAR(191) NOT NULL,
    `applicant_name` VARCHAR(191) NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
    `reviewed_by` VARCHAR(191) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `review_comment` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hall_task_leave_requests_task_record_id_idx`(`task_record_id`),
    INDEX `hall_task_leave_requests_status_idx`(`status`),
    INDEX `hall_task_leave_requests_applicant_user_id_idx`(`applicant_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `hall_task_leave_requests` ADD CONSTRAINT `hall_task_leave_requests_task_record_id_fkey` FOREIGN KEY (`task_record_id`) REFERENCES `hall_task_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
