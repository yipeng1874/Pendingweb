import { Router } from "express";
import { authRequired } from "../../../middleware/authRequired.js";
import { identityRequired } from "../../../middleware/identityRequired.js";
import { permissionRequired } from "../../../middleware/permissionRequired.js";
import { AssignmentController } from "./assignment.controller.js";

export const assignmentRoutes = Router();
assignmentRoutes.use(authRequired, identityRequired);

assignmentRoutes.get("/tasks/assignments", permissionRequired("task:assignment:view"), AssignmentController.list);
assignmentRoutes.get("/tasks/assignments/:id", permissionRequired("task:assignment:view"), AssignmentController.getById);
assignmentRoutes.get("/tasks/assignments/:id/targets", permissionRequired("task:assignment:view"), AssignmentController.getTargetUsers);
assignmentRoutes.post("/tasks/assignments", permissionRequired("task:assignment:manage"), AssignmentController.create);
assignmentRoutes.post("/tasks/assignments/temporary-drafts", permissionRequired("task:assignment:manage"), AssignmentController.saveTemporaryDraft);
assignmentRoutes.get("/tasks/assignments/:id/temporary-preview", permissionRequired("task:assignment:view"), AssignmentController.getTemporaryPublishPreview);
assignmentRoutes.post("/tasks/assignments/:id/temporary-publish", permissionRequired("task:assignment:manage"), AssignmentController.publishTemporaryDraft);
assignmentRoutes.post("/tasks/assignments/daily-drafts", permissionRequired("task:assignment:manage"), AssignmentController.saveDailyDraft);
assignmentRoutes.get("/tasks/assignments/:id/publish-preview", permissionRequired("task:assignment:view"), AssignmentController.getDailyPublishPreview);
assignmentRoutes.post("/tasks/assignments/:id/publish", permissionRequired("task:assignment:manage"), AssignmentController.publishDailyDraft);

assignmentRoutes.patch("/tasks/assignments/:id", permissionRequired("task:assignment:manage"), AssignmentController.update);
assignmentRoutes.delete("/tasks/assignments/:id", permissionRequired("task:assignment:manage"), AssignmentController.remove);
assignmentRoutes.post("/tasks/assignments/:id/close", permissionRequired("task:assignment:manage"), AssignmentController.close);
assignmentRoutes.post("/tasks/assignments/:id/reopen", permissionRequired("task:assignment:manage"), AssignmentController.reopen);
