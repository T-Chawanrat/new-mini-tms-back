import express from "express";
import { login, selectWarehouse } from "../controllers/auth.controller.js";

const router = express.Router();

router.post("/login", login);
router.post("/select-warehouse", selectWarehouse);

export default router;
