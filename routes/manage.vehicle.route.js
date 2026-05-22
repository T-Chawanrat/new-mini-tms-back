import express from "express";
import { getVehicles, createVehicle, updateVehicle, updateVehicleStatus, deleteVehicle } from "../controllers/manage.vehicle.controller.js";
import { allow } from "../middlewares/allow.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

// VEHICLES
router.get("/", auth, getVehicles);
router.post("/", auth, allow(1, 3, 4, 5, 10), createVehicle);
router.put("/:id", auth, allow(1, 3, 4, 5, 10), updateVehicle);
router.patch("/:id/status", auth, allow(1, 3, 4, 5, 10), updateVehicleStatus);
router.delete("/:id", auth, allow(1, 3, 4, 5, 10), deleteVehicle);

export default router;
