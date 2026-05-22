import express from "express";
import { getUsers, createUser, updateUser, changeMyPassword } from "../controllers/manage.user.controller.js";
import { allow } from "../middlewares/allow.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

// USERS
router.get("/", auth, getUsers);
router.post("/", auth, allow(1, 9, 10), createUser);
router.put("/:id", auth, allow(1, 9, 10, 11), updateUser);
router.patch("/change-password", auth, changeMyPassword);
// router.delete("/:id/hard", auth, allow(1, 10, 11), deleteUserHard);

export default router;
