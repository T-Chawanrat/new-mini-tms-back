import express from "express";
import {
  importBillsData,
  updateBillsWarehouseAccept,
  getBillsWarehouse,
  getBillsDC,
  updateBillsDCAccept,
  importBillsADV,
  importBillsVGT,
  getBillsReport,
  getBillsDataBySerial
} from "../controllers/billsDataController.js";

const router = express.Router();

router.get("/bills-data", getBillsReport);
router.get("/bills-data/by-serial", getBillsDataBySerial);
router.post("/import-bills", importBillsData);
router.post("/import-adv", importBillsADV);
router.post("/import-vgt", importBillsVGT);
router.get("/bills-warehouse", getBillsWarehouse);
router.post("/bills-warehouse/accept", updateBillsWarehouseAccept);
router.get("/bills-dc", getBillsDC);
router.post("/bills-dc/accept", updateBillsDCAccept);

export default router;
