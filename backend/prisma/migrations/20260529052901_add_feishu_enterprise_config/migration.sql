-- CreateTable
CREATE TABLE `anchor_registration_applications` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `anchor_nickname` VARCHAR(191) NOT NULL,
    `target_hall_org_id` VARCHAR(191) NOT NULL,
    `douyin_no` VARCHAR(191) NULL,
    `douyin_uid` VARCHAR(191) NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
    `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewed_by` VARCHAR(191) NULL,
    `reviewed_at` DATETIME(3) NULL,

    INDEX `anchor_registration_applications_user_id_idx`(`user_id`),
    INDEX `anchor_registration_applications_target_hall_org_id_idx`(`target_hall_org_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `nickname` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(191) NOT NULL,
    `avatar_url` VARCHAR(191) NULL,
    `feishu_open_id` VARCHAR(191) NULL,
    `feishu_union_id` VARCHAR(191) NULL,
    `feishu_config_id` VARCHAR(191) NULL,
    `feishu_name` VARCHAR(191) NULL,
    `feishu_avatar_url` VARCHAR(191) NULL,
    `feishu_bound_at` DATETIME(3) NULL,
    `status` ENUM('active', 'disabled', 'locked') NOT NULL DEFAULT 'active',
    `must_change_password` BOOLEAN NOT NULL DEFAULT true,
    `last_login_at` DATETIME(3) NULL,
    `created_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_phone_key`(`phone`),
    UNIQUE INDEX `users_feishu_open_id_key`(`feishu_open_id`),
    UNIQUE INDEX `users_feishu_union_id_key`(`feishu_union_id`),
    INDEX `users_feishu_config_id_idx`(`feishu_config_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `org_units` (
    `id` VARCHAR(191) NOT NULL,
    `org_code` VARCHAR(191) NOT NULL,
    `org_type` ENUM('HQ', 'BASE', 'TEAM', 'HALL') NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `parent_id` VARCHAR(191) NULL,
    `path` VARCHAR(191) NOT NULL,
    `depth` INTEGER NOT NULL DEFAULT 1,
    `principal_name` VARCHAR(191) NULL,
    `contact_phone` VARCHAR(191) NULL,
    `douyin_no` VARCHAR(191) NULL,
    `douyin_uid` VARCHAR(191) NULL,
    `broker_name` VARCHAR(191) NULL,
    `is_virtual` BOOLEAN NOT NULL DEFAULT false,
    `remark` TEXT NULL,
    `status` ENUM('active', 'paused') NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `org_units_org_code_key`(`org_code`),
    UNIQUE INDEX `org_units_douyin_no_key`(`douyin_no`),
    UNIQUE INDEX `org_units_douyin_uid_key`(`douyin_uid`),
    INDEX `org_units_parent_id_idx`(`parent_id`),
    INDEX `org_units_path_idx`(`path`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feishu_enterprise_configs` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `app_id` VARCHAR(191) NOT NULL,
    `app_secret` VARCHAR(191) NOT NULL,
    `base_org_id` VARCHAR(191) NOT NULL,
    `team_org_id` VARCHAR(191) NOT NULL,
    `status` ENUM('active', 'paused') NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `feishu_enterprise_configs_base_org_id_idx`(`base_org_id`),
    INDEX `feishu_enterprise_configs_team_org_id_idx`(`team_org_id`),
    UNIQUE INDEX `feishu_enterprise_configs_team_org_id_name_key`(`team_org_id`, `name`),
    UNIQUE INDEX `feishu_enterprise_configs_app_id_key`(`app_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `anchor_profiles` (
    `id` VARCHAR(191) NOT NULL,
    `douyin_uid` VARCHAR(191) NOT NULL,
    `douyin_no` VARCHAR(191) NULL,
    `nickname` VARCHAR(191) NOT NULL,
    `hall_org_id` VARCHAR(191) NOT NULL,
    `bound_user_id` VARCHAR(191) NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'manual_import',
    `status` ENUM('unbound', 'bound', 'inactive') NOT NULL DEFAULT 'unbound',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `anchor_profiles_douyin_uid_key`(`douyin_uid`),
    INDEX `anchor_profiles_hall_org_id_idx`(`hall_org_id`),
    INDEX `anchor_profiles_douyin_no_idx`(`douyin_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `module` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `role_code` VARCHAR(191) NOT NULL,
    `permission_code` VARCHAR(191) NOT NULL,

    INDEX `role_permissions_permission_code_fkey`(`permission_code`),
    PRIMARY KEY (`role_code`, `permission_code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_identities` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `role_code` VARCHAR(191) NOT NULL,
    `org_id` VARCHAR(191) NULL,
    `anchor_profile_id` VARCHAR(191) NULL,
    `scope_path` VARCHAR(191) NULL,
    `status` ENUM('active', 'disabled', 'expired') NOT NULL DEFAULT 'active',
    `granted_by` VARCHAR(191) NULL,
    `granted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expired_at` DATETIME(3) NULL,
    `last_switched_at` DATETIME(3) NULL,

    INDEX `user_identities_user_id_idx`(`user_id`),
    INDEX `user_identities_scope_path_idx`(`scope_path`),
    INDEX `user_identities_anchor_profile_id_fkey`(`anchor_profile_id`),
    INDEX `user_identities_org_id_fkey`(`org_id`),
    INDEX `user_identities_role_code_fkey`(`role_code`),
    UNIQUE INDEX `user_identities_user_id_role_code_org_id_anchor_profile_id_key`(`user_id`, `role_code`, `org_id`, `anchor_profile_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `operator_user_id` VARCHAR(191) NOT NULL,
    `operator_identity_id` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `target_type` VARCHAR(191) NOT NULL,
    `target_id` VARCHAR(191) NULL,
    `detail_json` JSON NULL,
    `ip` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_operator_user_id_idx`(`operator_user_id`),
    INDEX `audit_logs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_templates` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `category` ENUM('DAILY', 'TEMPORARY') NOT NULL,
    `org_id` VARCHAR(191) NOT NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'draft',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `task_templates_org_id_idx`(`org_id`),
    INDEX `task_templates_category_idx`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_items` (
    `id` VARCHAR(191) NOT NULL,
    `template_id` VARCHAR(191) NOT NULL,
    `sort_order` INTEGER NOT NULL,
    `item_type` ENUM('QA', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'FILL_BLANK', 'LINK', 'ATTACHMENT') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `is_required` BOOLEAN NOT NULL DEFAULT true,
    `link_url` VARCHAR(191) NULL,

    INDEX `task_items_template_id_idx`(`template_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_item_options` (
    `id` VARCHAR(191) NOT NULL,
    `task_item_id` VARCHAR(191) NOT NULL,
    `sort_order` INTEGER NOT NULL,
    `label` VARCHAR(191) NOT NULL,

    INDEX `task_item_options_task_item_id_idx`(`task_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_template_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `template_id` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `snapshot_json` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `task_template_snapshots_template_id_version_key`(`template_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_assignments` (
    `id` VARCHAR(191) NOT NULL,
    `template_id` VARCHAR(191) NOT NULL,
    `template_version` INTEGER NULL,
    `category` ENUM('DAILY', 'TEMPORARY') NOT NULL,
    `status` ENUM('draft', 'scheduled', 'active', 'ended', 'deleted') NOT NULL DEFAULT 'active',
    `effect_mode` ENUM('immediate', 'next_midnight') NULL,
    `effective_at` DATETIME(3) NULL,
    `published_at` DATETIME(3) NULL,
    `ended_at` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,
    `owner_scope_path` VARCHAR(191) NULL,
    `target_role_type` VARCHAR(191) NOT NULL,
    `target_admin_levels` JSON NULL,
    `target_role_codes` JSON NULL,
    `target_user_ids` JSON NULL,
    `temporary_mode` ENUM('ACCOUNT', 'ANCHOR', 'MANAGER') NULL,
    `temporary_subject_org_type` ENUM('HQ', 'BASE', 'TEAM', 'HALL') NULL,
    `created_by_identity_id` VARCHAR(191) NULL,
    `deadline_at` DATETIME(3) NULL,
    `deadline_policy` VARCHAR(191) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` VARCHAR(191) NOT NULL,
    `created_by_org_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `task_assignments_template_id_idx`(`template_id`),
    INDEX `task_assignments_created_at_idx`(`created_at`),
    INDEX `task_assignments_category_status_effective_at_idx`(`category`, `status`, `effective_at`),
    INDEX `task_assignments_owner_scope_path_category_status_idx`(`owner_scope_path`, `category`, `status`),
    INDEX `task_assignments_created_by_category_status_idx`(`created_by`, `category`, `status`),
    INDEX `task_assignments_temporary_mode_category_idx`(`temporary_mode`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_assignment_targets` (
    `id` VARCHAR(191) NOT NULL,
    `assignment_id` VARCHAR(191) NOT NULL,
    `org_id` VARCHAR(191) NOT NULL,
    `org_path_snapshot` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `task_assignment_targets_assignment_id_idx`(`assignment_id`),
    INDEX `task_assignment_targets_org_id_idx`(`org_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_assignment_exclusions` (
    `id` VARCHAR(191) NOT NULL,
    `assignment_id` VARCHAR(191) NOT NULL,
    `exclusion_type` ENUM('ORG', 'ANCHOR') NOT NULL,
    `org_id` VARCHAR(191) NULL,
    `org_path_snapshot` VARCHAR(191) NULL,
    `anchor_profile_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `task_assignment_exclusions_assignment_id_idx`(`assignment_id`),
    INDEX `task_assignment_exclusions_assignment_id_exclusion_type_idx`(`assignment_id`, `exclusion_type`),
    INDEX `task_assignment_exclusions_org_id_idx`(`org_id`),
    INDEX `task_assignment_exclusions_anchor_profile_id_idx`(`anchor_profile_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_records` (
    `id` VARCHAR(191) NOT NULL,
    `assignment_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `identity_id` VARCHAR(191) NULL,
    `subject_type` ENUM('USER', 'ORG') NOT NULL DEFAULT 'USER',
    `subject_key` VARCHAR(191) NOT NULL,
    `subject_user_id` VARCHAR(191) NULL,
    `subject_org_id` VARCHAR(191) NULL,
    `subject_name` VARCHAR(191) NULL,
    `subject_org_type` ENUM('HQ', 'BASE', 'TEAM', 'HALL') NULL,
    `template_version` INTEGER NOT NULL,
    `record_date` VARCHAR(191) NULL,
    `deadline_at` DATETIME(3) NOT NULL,
    `status` ENUM('pending', 'in_progress', 'submitted', 'overdue') NOT NULL DEFAULT 'pending',
    `total_items` INTEGER NOT NULL DEFAULT 0,
    `done_items` INTEGER NOT NULL DEFAULT 0,
    `submitted_at` DATETIME(3) NULL,
    `last_submitted_by_user_id` VARCHAR(191) NULL,
    `last_submitted_by_identity_id` VARCHAR(191) NULL,
    `last_submitted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `task_records_user_id_idx`(`user_id`),
    INDEX `task_records_subject_user_id_idx`(`subject_user_id`),
    INDEX `task_records_subject_org_id_idx`(`subject_org_id`),
    INDEX `task_records_assignment_id_idx`(`assignment_id`),
    INDEX `task_records_record_date_idx`(`record_date`),
    UNIQUE INDEX `task_records_assignment_id_subject_key_record_date_key`(`assignment_id`, `subject_key`, `record_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_record_identity_links` (
    `id` VARCHAR(191) NOT NULL,
    `task_record_id` VARCHAR(191) NOT NULL,
    `identity_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `role_code` VARCHAR(191) NOT NULL,
    `org_id` VARCHAR(191) NULL,
    `anchor_profile_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `task_record_identity_links_task_record_id_idx`(`task_record_id`),
    INDEX `task_record_identity_links_identity_id_idx`(`identity_id`),
    INDEX `task_record_identity_links_user_id_idx`(`user_id`),
    INDEX `task_record_identity_links_org_id_idx`(`org_id`),
    UNIQUE INDEX `task_record_identity_links_task_record_id_identity_id_key`(`task_record_id`, `identity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_item_records` (
    `id` VARCHAR(191) NOT NULL,
    `task_record_id` VARCHAR(191) NOT NULL,
    `task_item_id` VARCHAR(191) NOT NULL,
    `status` ENUM('pending', 'done') NOT NULL DEFAULT 'pending',
    `answer_text` TEXT NULL,
    `answer_options` JSON NULL,
    `is_link_confirmed` BOOLEAN NOT NULL DEFAULT false,
    `done_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `task_item_records_task_record_id_idx`(`task_record_id`),
    INDEX `task_item_records_task_item_id_fkey`(`task_item_id`),
    UNIQUE INDEX `task_item_records_task_record_id_task_item_id_key`(`task_record_id`, `task_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_item_attachments` (
    `id` VARCHAR(191) NOT NULL,
    `task_item_record_id` VARCHAR(191) NOT NULL,
    `file_name` VARCHAR(191) NOT NULL,
    `file_url` VARCHAR(191) NOT NULL,
    `file_size` INTEGER NOT NULL,
    `mime_type` VARCHAR(191) NOT NULL,
    `uploaded_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `task_item_attachments_task_item_record_id_idx`(`task_item_record_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_exemptions` (
    `id` VARCHAR(191) NOT NULL,
    `task_record_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    `reviewed_by` VARCHAR(191) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `task_exemptions_task_record_id_key`(`task_record_id`),
    INDEX `task_exemptions_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `personal_reminders` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `note` TEXT NULL,
    `remind_at` DATETIME(3) NULL,
    `remind_end` DATETIME(3) NULL,
    `remind_start` DATETIME(3) NULL,
    `repeat_type` ENUM('once', 'daily', 'weekly', 'workday') NULL,
    `is_important` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('active', 'done') NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `personal_reminders_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `anchor_registration_applications` ADD CONSTRAINT `anchor_registration_applications_target_hall_org_id_fkey` FOREIGN KEY (`target_hall_org_id`) REFERENCES `org_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_feishu_config_id_fkey` FOREIGN KEY (`feishu_config_id`) REFERENCES `feishu_enterprise_configs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `feishu_enterprise_configs` ADD CONSTRAINT `feishu_enterprise_configs_base_org_id_fkey` FOREIGN KEY (`base_org_id`) REFERENCES `org_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `feishu_enterprise_configs` ADD CONSTRAINT `feishu_enterprise_configs_team_org_id_fkey` FOREIGN KEY (`team_org_id`) REFERENCES `org_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `anchor_profiles` ADD CONSTRAINT `anchor_profiles_hall_org_id_fkey` FOREIGN KEY (`hall_org_id`) REFERENCES `org_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_code_fkey` FOREIGN KEY (`permission_code`) REFERENCES `permissions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_code_fkey` FOREIGN KEY (`role_code`) REFERENCES `roles`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_identities` ADD CONSTRAINT `user_identities_anchor_profile_id_fkey` FOREIGN KEY (`anchor_profile_id`) REFERENCES `anchor_profiles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_identities` ADD CONSTRAINT `user_identities_org_id_fkey` FOREIGN KEY (`org_id`) REFERENCES `org_units`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_identities` ADD CONSTRAINT `user_identities_role_code_fkey` FOREIGN KEY (`role_code`) REFERENCES `roles`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_identities` ADD CONSTRAINT `user_identities_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_items` ADD CONSTRAINT `task_items_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `task_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_item_options` ADD CONSTRAINT `task_item_options_task_item_id_fkey` FOREIGN KEY (`task_item_id`) REFERENCES `task_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_template_snapshots` ADD CONSTRAINT `task_template_snapshots_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `task_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_assignments` ADD CONSTRAINT `task_assignments_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `task_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_assignment_targets` ADD CONSTRAINT `task_assignment_targets_assignment_id_fkey` FOREIGN KEY (`assignment_id`) REFERENCES `task_assignments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_assignment_targets` ADD CONSTRAINT `task_assignment_targets_org_id_fkey` FOREIGN KEY (`org_id`) REFERENCES `org_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_assignment_exclusions` ADD CONSTRAINT `task_assignment_exclusions_anchor_profile_id_fkey` FOREIGN KEY (`anchor_profile_id`) REFERENCES `anchor_profiles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_assignment_exclusions` ADD CONSTRAINT `task_assignment_exclusions_assignment_id_fkey` FOREIGN KEY (`assignment_id`) REFERENCES `task_assignments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_assignment_exclusions` ADD CONSTRAINT `task_assignment_exclusions_org_id_fkey` FOREIGN KEY (`org_id`) REFERENCES `org_units`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_records` ADD CONSTRAINT `task_records_assignment_id_fkey` FOREIGN KEY (`assignment_id`) REFERENCES `task_assignments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_records` ADD CONSTRAINT `task_records_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_records` ADD CONSTRAINT `task_records_subject_org_id_fkey` FOREIGN KEY (`subject_org_id`) REFERENCES `org_units`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_record_identity_links` ADD CONSTRAINT `task_record_identity_links_org_id_fkey` FOREIGN KEY (`org_id`) REFERENCES `org_units`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_record_identity_links` ADD CONSTRAINT `task_record_identity_links_identity_id_fkey` FOREIGN KEY (`identity_id`) REFERENCES `user_identities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_record_identity_links` ADD CONSTRAINT `task_record_identity_links_task_record_id_fkey` FOREIGN KEY (`task_record_id`) REFERENCES `task_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_record_identity_links` ADD CONSTRAINT `task_record_identity_links_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_item_records` ADD CONSTRAINT `task_item_records_task_item_id_fkey` FOREIGN KEY (`task_item_id`) REFERENCES `task_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_item_records` ADD CONSTRAINT `task_item_records_task_record_id_fkey` FOREIGN KEY (`task_record_id`) REFERENCES `task_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_item_attachments` ADD CONSTRAINT `task_item_attachments_task_item_record_id_fkey` FOREIGN KEY (`task_item_record_id`) REFERENCES `task_item_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_exemptions` ADD CONSTRAINT `task_exemptions_task_record_id_fkey` FOREIGN KEY (`task_record_id`) REFERENCES `task_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
