import express from "express";
import { getUsers, createUser, updateUser, changeMyPassword } from "../../controllers/admin/manage.user.controller.js";
import { auth } from "../../middlewares/auth.js";

const router = express.Router();

// USERS
router.get("/", auth, getUsers);
router.post("/", auth, createUser);
router.put("/:id", auth, updateUser);
router.patch("/change-password", auth, changeMyPassword);
// router.delete("/:id/hard", auth, allow(1, 10, 11), deleteUserHard);

export default router;
