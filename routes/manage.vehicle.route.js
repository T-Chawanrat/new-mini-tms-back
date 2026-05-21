import express from "express";
import { getVehicles, createVehicle, updateVehicle, deleteVehicle } from "../controllers/manage.vehicle.controller.js";
import { allow } from "../middlewares/allow.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

// VEHICLES
router.get("/vehicles", auth, getVehicles);
router.post("/vehicles", auth, allow(1, 3, 4, 5, 10), createVehicle);
router.patch("/vehicles/:id", auth, allow(1, 3, 4, 5, 10), updateVehicle);
router.delete("/vehicles/:id", auth, allow(1, 3, 4, 5, 10), deleteVehicle);

export default router;
