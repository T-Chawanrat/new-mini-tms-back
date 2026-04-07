import express from "express";
import { getCustomers, getWarehouses, searchAddress, getDropdownWarehouse} from "../controllers/filterController.js";

const router = express.Router();

router.get("/customers", getCustomers);
router.get("/select-warehouse", getDropdownWarehouse);
router.get("/warehouses", getWarehouses);
router.get("/address-search", searchAddress);


export default router;