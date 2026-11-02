import { Router } from "express";
import { auth } from "../../middlewares/auth.js";
import { getPermissions, getMyPermissions, initializePermissions, getRolePermissions, saveRolePermissions, getUserPermissions, saveUserPermissions } from "../../controllers/admin/manage.permission.controller.js";
import { getUserWarehouses, saveUserWarehouses } from "../../controllers/admin/manage.user.warehouse.controller.js";

const router = Router();
router.use(auth);
router.get("/me", getMyPermissions);
router.get("/", getPermissions);
router.post("/initialize", initializePermissions);
router.get("/roles/:roleId", getRolePermissions);
router.put("/roles/:roleId", saveRolePermissions);
router.get("/users/:userId", getUserPermissions);
router.put("/users/:userId", saveUserPermissions);
router.get("/users/:userId/warehouses", getUserWarehouses);
router.put("/users/:userId/warehouses", saveUserWarehouses);

export default router;
