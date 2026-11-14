import express from "express";
import { getWarehouses, searchAddress, getRecipientTypes, getReceivePayments, getProvinces } from "../../controllers/customer/filter.controller.js";

const router = express.Router();
router.get("/warehouses", getWarehouses);
router.get("/address-search", searchAddress);
router.get("/recipient-types", getRecipientTypes);
router.get("/payments", getReceivePayments);
router.get("/provinces", getProvinces);

export default router;
