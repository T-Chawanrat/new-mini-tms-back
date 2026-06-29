// server/routes/receive.create.routes.js

import express from "express";
import { createReceive } from "../controllers/receive.create.controller.js";
import { auth } from "../middlewares/auth.js";
import { allow } from "../middlewares/allow.js";

const router = express.Router();

router.post("/receives", auth, allow(1, 2, 3, 4, 5, 10), createReceive);

export default router;