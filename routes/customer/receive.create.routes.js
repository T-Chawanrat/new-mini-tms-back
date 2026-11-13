// server/routes/admin/receive.create.routes.js

import express from "express";
import { createReceive } from "../../controllers/customer/receive.create.controller.js";
import { customerAuth as auth } from "../../middlewares/auth.js";

const router = express.Router();

router.post("/receives", auth, createReceive);

export default router;
