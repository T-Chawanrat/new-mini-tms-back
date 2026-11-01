import express from "express";
import { createRoute, createRouteDetail, deleteRouteDetail, getRoutes, updateRoute, updateRouteDetail, updateRouteStatus } from "../../controllers/admin/manage.route.controller.js";
import { auth } from "../../middlewares/auth.js";

const router = express.Router();

router.get("/", auth, getRoutes);
router.post("/", auth, createRoute);
router.put("/:routeId", auth, updateRoute);
router.post("/:routeId/details", auth, createRouteDetail);
router.put("/:routeId/details/:routeDetailId", auth, updateRouteDetail);
router.patch("/:routeId/status", auth, updateRouteStatus);
router.delete("/:routeId/details/:routeDetailId", auth, deleteRouteDetail);

export default router;
