import express from "express";
import {
  getRecipients,
  createRecipient,
  createRecipientDetail,
  updateRecipient,
  updateRecipientDetailStatus,
} from "../controllers/manage.recipient.controller.js";
import { allow } from "../middlewares/allow.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

// RECIPIENTS
router.get("/customers/:customer_id/recipients", auth, getRecipients);
router.post("/customers/:customer_id/recipients", auth, allow(1, 2, 3, 4, 5, 10, 11), createRecipient);
router.post("/customers/:customer_id/recipients/:id/details", auth, allow(1, 2, 3, 4, 5, 10, 11), createRecipientDetail);
router.patch("/customers/:customer_id/recipients/:id", auth, allow(1, 2, 3, 4, 5, 10, 11), updateRecipient);
router.patch(
  "/customers/:customerId/recipients/:recipientId/details/:detailId/status",
  auth,
  allow(1, 2, 3, 4, 5, 10, 11),
  updateRecipientDetailStatus,
);

export default router;
