import express from "express";
import { getUsers, createUser, updateUser, deleteUserHard } from "../controllers/manage.user.controller.js";
import { allow } from "../middlewares/allow.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

// USERS
router.get("/users", auth, getUsers);
router.post("/users", auth, allow(1, 9, 10), createUser);
router.put("/users/:id", auth, allow(1, 9, 10, 11), updateUser);
router.delete("/users/:id/hard", auth, allow(1, 10, 11), deleteUserHard);

export default router;
