import express from "express";
import { login, selectWarehouse } from "../../controllers/admin/auth.controller.js";
import { getMyProfile, updateMyProfile } from "../../controllers/admin/user.profile.controller.js";
import { auth } from "../../middlewares/auth.js";

const router = express.Router();

router.post("/login", login);
router.post("/select-warehouse", selectWarehouse);
router.get("/profile", auth, getMyProfile);
router.patch("/profile", auth, updateMyProfile);

export default router;
