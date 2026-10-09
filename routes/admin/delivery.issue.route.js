import express from "express";
import multer from "multer";
import { auth } from "../../middlewares/auth.js";
import { createDeliveryIssue, createDeliveryIssueMessage, getDeliveryIssueMessages, getDeliveryIssueThreads, updateDeliveryIssueStatus } from "../../controllers/admin/delivery.issue.controller.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 4, fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, callback) => callback(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) });
router.get("/", auth, getDeliveryIssueThreads);
router.post("/:receiveCode", auth, createDeliveryIssue);
router.get("/:receiveCode/messages", auth, getDeliveryIssueMessages);
router.patch("/:receiveCode/status", auth, updateDeliveryIssueStatus);
router.post("/:receiveCode/messages", auth, upload.fields([{ name: "images", maxCount: 4 }]), createDeliveryIssueMessage);
export default router;
