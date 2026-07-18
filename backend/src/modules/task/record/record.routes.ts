import { Router } from "express";
import { authRequired } from "../../../middleware/authRequired.js";
import { identityRequired } from "../../../middleware/identityRequired.js";
import { permissionRequired } from "../../../middleware/permissionRequired.js";
import { RecordController } from "./record.controller.js";

export const recordRoutes = Router();
recordRoutes.use(authRequired, identityRequired);

// 主播端：我的待办
recordRoutes.get("/tasks/my-records", permissionRequired("task:record:submit"), RecordController.getMyRecords);
recordRoutes.get("/tasks/my-records/:id", permissionRequired("task:record:submit"), RecordController.getRecord);
recordRoutes.post("/tasks/item-records", permissionRequired("task:record:submit"), RecordController.submitItemRecord);
recordRoutes.post("/tasks/my-records/:id/submit", permissionRequired("task:record:submit"), RecordController.submitRecord);
recordRoutes.post("/tasks/my-records/:id/reconfirm", permissionRequired("task:record:submit"), RecordController.reconfirmRecord);
recordRoutes.post("/tasks/exemptions", permissionRequired("task:exemption:apply"), RecordController.applyExemption);
recordRoutes.delete("/tasks/exemptions/:taskRecordId", permissionRequired("task:exemption:apply"), RecordController.cancelExemption);

// 管理侧：豁免审批
recordRoutes.get("/tasks/exemptions", permissionRequired("task:exemption:review"), RecordController.listExemptions);
recordRoutes.post("/tasks/exemptions/:id/review", permissionRequired("task:exemption:review"), RecordController.reviewExemption);
