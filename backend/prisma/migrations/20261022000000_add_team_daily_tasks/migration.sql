-- CreateTable
CREATE TABLE `team_task_templates` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `base_org_id` VARCHAR(191) NOT NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('draft', 'archived') NOT NULL DEFAULT 'draft',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `team_task_templates_base_org_id_idx`(`base_org_id`),
    INDEX `team_task_templates_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `team_task_items` (
    `id` VARCHAR(191) NOT NULL,
    `template_id` VARCHAR(191) NOT NULL,
    `sort_order` INTEGER NOT NULL,
    `item_type` ENUM('QA', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'FILL_BLANK', 'LINK', 'ATTACHMENT') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `is_required` BOOLEAN NOT NULL DEFAULT true,
    `link_url` VARCHAR(191) NULL,

    INDEX `team_task_items_template_id_idx`(`template_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `team_task_item_options` (
    `id` VARCHAR(191) NOT NULL,
    `task_item_id` VARCHAR(191) NOT NULL,
    `sort_order` INTEGER NOT NULL,
    `label` VARCHAR(191) NOT NULL,

    INDEX `team_task_item_options_task_item_id_idx`(`task_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `team_task_assignments` (
    `id` VARCHAR(191) NOT NULL,
    `template_id` VARCHAR(191) NOT NULL,
    `base_org_id` VARCHAR(191) NOT NULL,
    `status` ENUM('draft', 'scheduled', 'active', 'ended', 'deleted') NOT NULL DEFAULT 'draft',
    `effect_mode` ENUM('immediate', 'next_midnight') NOT NULL DEFAULT 'immediate',
    `effective_at` DATETIME(3) NULL,
    `published_at` DATETIME(3) NULL,
    `ended_at` DATETIME(3) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `created_by_org_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `team_task_assignments_template_id_idx`(`template_id`),
    INDEX `team_task_assignments_base_org_id_status_idx`(`base_org_id`, `status`),
    INDEX `team_task_assignments_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `team_task_assignment_targets` (
    `id` VARCHAR(191) NOT NULL,
    `assignment_id` VARCHAR(191) NOT NULL,
    `team_org_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `team_task_assignment_targets_assignment_id_idx`(`assignment_id`),
    INDEX `team_task_assignment_targets_team_org_id_idx`(`team_org_id`),
    UNIQUE INDEX `team_task_assignment_targets_assignment_id_team_org_id_key`(`assignment_id`, `team_org_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `team_task_records` (
    `id` VARCHAR(191) NOT NULL,
    `assignment_id` VARCHAR(191) NOT NULL,
    `team_org_id` VARCHAR(191) NOT NULL,
    `record_date` VARCHAR(191) NOT NULL,
    `status` ENUM('pending', 'in_progress', 'submitted', 'overdue') NOT NULL DEFAULT 'pending',
    `total_items` INTEGER NOT NULL DEFAULT 0,
    `done_items` INTEGER NOT NULL DEFAULT 0,
    `submitted_at` DATETIME(3) NULL,
    `submitted_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `team_task_records_assignment_id_idx`(`assignment_id`),
    INDEX `team_task_records_team_org_id_idx`(`team_org_id`),
    INDEX `team_task_records_record_date_idx`(`record_date`),
    INDEX `team_task_records_record_date_team_org_id_idx`(`record_date`, `team_org_id`),
    UNIQUE INDEX `team_task_records_assignment_id_team_org_id_record_date_key`(`assignment_id`, `team_org_id`, `record_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `team_task_leave_requests` (
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

    INDEX `team_task_leave_requests_task_record_id_idx`(`task_record_id`),
    INDEX `team_task_leave_requests_status_idx`(`status`),
    INDEX `team_task_leave_requests_applicant_user_id_idx`(`applicant_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `team_task_item_records` (
    `id` VARCHAR(191) NOT NULL,
    `task_record_id` VARCHAR(191) NOT NULL,
    `task_item_id` VARCHAR(191) NOT NULL,
    `status` ENUM('pending', 'done') NOT NULL DEFAULT 'pending',
    `answer_text` TEXT NULL,
    `answer_options` JSON NULL,
    `is_link_confirmed` BOOLEAN NOT NULL DEFAULT false,
    `done_at` DATETIME(3) NULL,
    `done_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `team_task_item_records_task_record_id_idx`(`task_record_id`),
    INDEX `team_task_item_records_task_item_id_idx`(`task_item_id`),
    UNIQUE INDEX `team_task_item_records_task_record_id_task_item_id_key`(`task_record_id`, `task_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `team_task_item_attachments` (
    `id` VARCHAR(191) NOT NULL,
    `team_task_item_record_id` VARCHAR(191) NOT NULL,
    `file_name` VARCHAR(191) NOT NULL,
    `file_url` VARCHAR(191) NOT NULL,
    `file_size` INTEGER NOT NULL,
    `mime_type` VARCHAR(191) NOT NULL,
    `uploaded_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `team_task_item_attachments_team_task_item_record_id_idx`(`team_task_item_record_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `team_task_templates` ADD CONSTRAINT `team_task_templates_base_org_id_fkey` FOREIGN KEY (`base_org_id`) REFERENCES `org_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_task_items` ADD CONSTRAINT `team_task_items_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `team_task_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_task_item_options` ADD CONSTRAINT `team_task_item_options_task_item_id_fkey` FOREIGN KEY (`task_item_id`) REFERENCES `team_task_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_task_assignments` ADD CONSTRAINT `team_task_assignments_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `team_task_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_task_assignments` ADD CONSTRAINT `team_task_assignments_base_org_id_fkey` FOREIGN KEY (`base_org_id`) REFERENCES `org_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_task_assignment_targets` ADD CONSTRAINT `team_task_assignment_targets_assignment_id_fkey` FOREIGN KEY (`assignment_id`) REFERENCES `team_task_assignments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_task_assignment_targets` ADD CONSTRAINT `team_task_assignment_targets_team_org_id_fkey` FOREIGN KEY (`team_org_id`) REFERENCES `org_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_task_records` ADD CONSTRAINT `team_task_records_assignment_id_fkey` FOREIGN KEY (`assignment_id`) REFERENCES `team_task_assignments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_task_records` ADD CONSTRAINT `team_task_records_team_org_id_fkey` FOREIGN KEY (`team_org_id`) REFERENCES `org_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_task_leave_requests` ADD CONSTRAINT `team_task_leave_requests_task_record_id_fkey` FOREIGN KEY (`task_record_id`) REFERENCES `team_task_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_task_item_records` ADD CONSTRAINT `team_task_item_records_task_record_id_fkey` FOREIGN KEY (`task_record_id`) REFERENCES `team_task_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_task_item_records` ADD CONSTRAINT `team_task_item_records_task_item_id_fkey` FOREIGN KEY (`task_item_id`) REFERENCES `team_task_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_task_item_attachments` ADD CONSTRAINT `team_task_item_attachments_team_task_item_record_id_fkey` FOREIGN KEY (`team_task_item_record_id`) REFERENCES `team_task_item_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
