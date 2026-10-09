import express from "express";

import { getDriverTrucks } from "../../controllers/driver/driver.truck.controller.js";
import { auth } from "../../middlewares/auth.js";

const router = express.Router();

router.get("/", auth, getDriverTrucks);

export default router;
