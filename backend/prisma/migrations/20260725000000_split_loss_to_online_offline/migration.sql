-- 离职指标拆分为线上/线下两个子分类
ALTER TABLE `staff_turnover_dailies`
    ADD COLUMN `loss_online_count`   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `loss_online_avg_wave` DOUBLE  NOT NULL DEFAULT 0,
    ADD COLUMN `loss_offline_count`  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `loss_offline_avg_wave` DOUBLE NOT NULL DEFAULT 0;
