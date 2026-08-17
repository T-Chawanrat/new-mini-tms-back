import express from "express";
import { driverLogin } from "../controllers/auth.driver.controller.js";

const router = express.Router();

router.post("/login", driverLogin);

export default router;
