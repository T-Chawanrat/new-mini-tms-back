import express from "express";
import {
  getRecipients,
  getRecipientDetails,
  createRecipient,
  createRecipientDetail,
  updateRecipient,
  updateRecipientDetailStatus,
} from "../../controllers/admin/manage.recipient.controller.js";
import { auth } from "../../middlewares/auth.js";

const router = express.Router();

// RECIPIENTS
router.get("/:customer_id", auth, getRecipients);
router.get("/:customerId/:recipientId/details", auth, getRecipientDetails);
router.post("/:customer_id", auth, createRecipient);
router.post("/:customer_id/:id/details", auth, createRecipientDetail);
router.patch("/:customerId/:recipientId/details/:detailId/status", auth, updateRecipientDetailStatus);
router.patch("/:customer_id/:id", auth, updateRecipient);

export default router;
