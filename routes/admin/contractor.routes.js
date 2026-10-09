import express from "express";

import {
  createContractor,
  getAvailableContractors,
} from "../../controllers/admin/contractor.controller.js";
import { auth } from "../../middlewares/auth.js";

const router = express.Router();

router.get("/available", auth, getAvailableContractors);
router.post("/", auth, createContractor);

export default router;
