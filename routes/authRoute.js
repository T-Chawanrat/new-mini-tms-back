// routes/authRoutes.js
import express from "express";
import { login } from "../controllers/authController.js";
// import { auth } from "../middlewares/auth.js";

const router = express.Router();

router.post("/login", login);

// router.get("/me", auth, (req, res) => {
//   res.status(200).json({
//     message: "Token ใช้ได้",
//     user: req.user,
//   });
// });

export default router;
