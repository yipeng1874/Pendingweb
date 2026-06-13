import { Router } from "express";
import { authRequired } from "../../../middleware/authRequired.js";
import { identityRequired } from "../../../middleware/identityRequired.js";
import { permissionRequired } from "../../../middleware/permissionRequired.js";
import { TemplateController } from "./template.controller.js";

export const templateRoutes = Router();
templateRoutes.use(authRequired, identityRequired);

templateRoutes.get("/tasks/templates", permissionRequired("task:assignment:view"), TemplateController.list);
templateRoutes.get("/tasks/templates/:id", permissionRequired("task:assignment:view"), TemplateController.getById);
templateRoutes.post("/tasks/templates", permissionRequired("task:template:manage"), TemplateController.create);
templateRoutes.patch("/tasks/templates/:id", permissionRequired("task:template:manage"), TemplateController.update);
templateRoutes.delete("/tasks/templates/:id", permissionRequired("task:template:manage"), TemplateController.remove);
templateRoutes.post("/tasks/templates/:id/copy", permissionRequired("task:template:manage"), TemplateController.copy);

