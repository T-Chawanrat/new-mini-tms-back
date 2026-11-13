import express from "express";
import { login } from "../../controllers/customer/auth.controller.js";

const router = express.Router();

router.post("/login", login);

export default router;
