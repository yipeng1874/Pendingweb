import { Router } from "express";
import { authRequired } from "../../middleware/authRequired.js";
import { identityRequired } from "../../middleware/identityRequired.js";
import { permissionRequired } from "../../middleware/permissionRequired.js";
import { AnchorController } from "./controller.js";
import { ExportTaskController } from "./export-task.controller.js";
export const anchorRoutes = Router();
function asyncHandler(handler) {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}
// Public routes
anchorRoutes.get("/anchors/register/orgs", asyncHandler(AnchorController.getRegisterOrgs));
anchorRoutes.get("/anchors/halls", asyncHandler(AnchorController.getHalls));
anchorRoutes.post("/anchors/register", asyncHandler(AnchorController.register));
// Protected routes
anchorRoutes.use(authRequired, identityRequired);
anchorRoutes.get("/anchors/org-children", permissionRequired("org:view"), asyncHandler(AnchorController.getOrgChildren));
anchorRoutes.get("/anchors/profiles", permissionRequired("anchor:view"), asyncHandler(AnchorController.getProfiles));
anchorRoutes.get("/anchors/profiles/export", permissionRequired("anchor:view"), asyncHandler(AnchorController.exportProfiles));
anchorRoutes.get("/anchors/profiles/:id", permissionRequired("anchor:view"), asyncHandler(AnchorController.getProfileDetail));
anchorRoutes.post("/anchors/profiles", permissionRequired("anchor:profile:create"), asyncHandler(AnchorController.createProfile));
anchorRoutes.patch("/anchors/profiles/:id", permissionRequired("anchor:profile:create"), asyncHandler(AnchorController.updateProfile));
anchorRoutes.post("/anchors/profiles/:id/migrate", permissionRequired("anchor:profile:bind"), asyncHandler(AnchorController.migrateProfile));
anchorRoutes.post("/anchors/profiles/:id/disable", permissionRequired("anchor:profile:bind"), asyncHandler(AnchorController.disableProfile));
anchorRoutes.post("/anchors/profiles/:id/enable", permissionRequired("anchor:profile:bind"), asyncHandler(AnchorController.enableProfile));
anchorRoutes.delete("/anchors/profiles/:id", permissionRequired("anchor:profile:bind"), asyncHandler(AnchorController.deleteProfile));
anchorRoutes.get("/anchors/applications", permissionRequired("anchor:registration:review"), asyncHandler(AnchorController.getApplications));
anchorRoutes.get("/anchors/applications/:id", permissionRequired("anchor:registration:review"), asyncHandler(AnchorController.getApplicationDetail));
anchorRoutes.get("/anchors/applications/:id/candidates", permissionRequired("anchor:registration:review"), asyncHandler(AnchorController.getCandidates));
anchorRoutes.post("/anchors/applications/:id/review", permissionRequired("anchor:registration:review"), asyncHandler(AnchorController.reviewApplication));
// 异步导出任务
anchorRoutes.post("/anchors/export-tasks", permissionRequired("anchor:view"), asyncHandler(ExportTaskController.createTask));
anchorRoutes.get("/anchors/export-tasks", permissionRequired("anchor:view"), asyncHandler(ExportTaskController.listMyTasks));
anchorRoutes.get("/anchors/export-tasks/:id/file", permissionRequired("anchor:view"), asyncHandler(ExportTaskController.downloadFile));
