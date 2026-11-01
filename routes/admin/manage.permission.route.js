import { Router } from "express";
import { auth } from "../../middlewares/auth.js";
import { getPermissions, getMyPermissions, initializePermissions, getRolePermissions, saveRolePermissions, getUserPermissions, saveUserPermissions } from "../../controllers/admin/manage.permission.controller.js";

const router = Router();
router.use(auth);
router.get("/me", getMyPermissions);
router.get("/", getPermissions);
router.post("/initialize", initializePermissions);
router.get("/roles/:roleId", getRolePermissions);
router.put("/roles/:roleId", saveRolePermissions);
router.get("/users/:userId", getUserPermissions);
router.put("/users/:userId", saveUserPermissions);

export default router;
