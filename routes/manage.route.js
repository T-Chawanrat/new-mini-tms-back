import express from "express";
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getVehicles,
  createVehicle,
  updateVehicle,
  deleteVehicle,
} from "../controllers/manage.controller.js";

import { allow } from "../middlewares/allow.js";

const router = express.Router();

// USERS
router.get("/users", allow(1, 9), getUsers);
router.post("/users", allow(1, 9), createUser);
router.put("/users/:id", allow(1, 9), updateUser);
router.delete("/users/:id", allow(1, 9), deleteUser);

// VEHICLES
router.get("/vehicles", allow(1, 9), getVehicles);
router.post("/vehicles", allow(1, 9), createVehicle);
router.patch("/vehicles/:id", allow(1, 9), updateVehicle);
router.delete("/vehicles/:id", allow(1, 9), deleteVehicle);

export default router;
