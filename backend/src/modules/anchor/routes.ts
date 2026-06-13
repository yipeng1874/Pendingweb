import { Router } from "express";
import { authRequired } from "../../middleware/authRequired.js";
import { identityRequired } from "../../middleware/identityRequired.js";
import { permissionRequired } from "../../middleware/permissionRequired.js";
import { AnchorController } from "./controller.js";

export const anchorRoutes = Router();

// Public routes
anchorRoutes.get("/anchors/register/orgs", AnchorController.getRegisterOrgs);
anchorRoutes.get("/anchors/halls", AnchorController.getHalls);
anchorRoutes.post("/anchors/register", AnchorController.register);

// Protected routes
anchorRoutes.use(authRequired, identityRequired);

anchorRoutes.get("/anchors/org-children", permissionRequired("org:view"), AnchorController.getOrgChildren);
anchorRoutes.get("/anchors/profiles", permissionRequired("anchor:view"), AnchorController.getProfiles);
anchorRoutes.get("/anchors/profiles/:id", permissionRequired("anchor:view"), AnchorController.getProfileDetail);
anchorRoutes.post("/anchors/profiles", permissionRequired("anchor:profile:create"), AnchorController.createProfile);
anchorRoutes.patch("/anchors/profiles/:id", permissionRequired("anchor:profile:create"), AnchorController.updateProfile);
anchorRoutes.post("/anchors/profiles/:id/disable", permissionRequired("anchor:profile:bind"), AnchorController.disableProfile);
anchorRoutes.post("/anchors/profiles/:id/enable", permissionRequired("anchor:profile:bind"), AnchorController.enableProfile);
anchorRoutes.delete("/anchors/profiles/:id", permissionRequired("anchor:profile:bind"), AnchorController.deleteProfile);

anchorRoutes.get("/anchors/applications", permissionRequired("anchor:registration:review"), AnchorController.getApplications);
anchorRoutes.get("/anchors/applications/:id", permissionRequired("anchor:registration:review"), AnchorController.getApplicationDetail);
anchorRoutes.get("/anchors/applications/:id/candidates", permissionRequired("anchor:registration:review"), AnchorController.getCandidates);
anchorRoutes.post("/anchors/applications/:id/review", permissionRequired("anchor:registration:review"), AnchorController.reviewApplication);
