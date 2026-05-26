import express from "express";
import { auth } from "../middlewares/auth.js";
import { allow } from "../middlewares/allow.js";

import { importSTD, manual } from "../controllers/import.controller.js";

const router = express.Router();

router.post("/std", auth, importSTD);
router.post("/manual", auth, manual);

export default router;
