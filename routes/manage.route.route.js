import express from "express";
import { createRoute, createRouteDetail, deleteRouteDetail, getRoutes, updateRoute, updateRouteDetail, updateRouteStatus } from "../controllers/manage.route.controller.js";
import { allow } from "../middlewares/allow.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

router.get("/", auth, getRoutes);
router.post("/", auth, allow(1, 3, 4, 5, 10), createRoute);
router.put("/:routeId", auth, allow(1, 3, 4, 5, 10), updateRoute);
router.post("/:routeId/details", auth, allow(1, 3, 4, 5, 10), createRouteDetail);
router.put("/:routeId/details/:routeDetailId", auth, allow(1, 3, 4, 5, 10), updateRouteDetail);
router.patch("/:routeId/status", auth, allow(1, 3, 4, 5, 10), updateRouteStatus);
router.delete("/:routeId/details/:routeDetailId", auth, allow(1, 3, 4, 5, 10), deleteRouteDetail);

export default router;
