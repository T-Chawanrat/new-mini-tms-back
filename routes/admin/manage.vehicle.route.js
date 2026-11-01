import express from "express";
import { getVehicles, createVehicle, updateVehicle, updateVehicleStatus, deleteVehicle } from "../../controllers/admin/manage.vehicle.controller.js";
import { auth } from "../../middlewares/auth.js";

const router = express.Router();

// VEHICLES
router.get("/", auth, getVehicles);
router.post("/", auth, createVehicle);
router.put("/:id", auth, updateVehicle);
router.patch("/:id/status", auth, updateVehicleStatus);
router.delete("/:id", auth, deleteVehicle);

export default router;
