import express from "express";
import { driverLogin } from "../../controllers/driver/driver.auth.controller.js";

const router = express.Router();

router.post("/login", driverLogin);

export default router;
