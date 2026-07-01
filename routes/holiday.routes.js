import express from "express";
import {
  getHolidays,
  getHolidayById,
  createHoliday,
  updateHoliday,
  deleteHoliday,
} from "../controllers/holiday.controller.js";

const router = express.Router();

router.get("/", getHolidays);
router.get("/:id", getHolidayById);
router.post("/", createHoliday);
router.put("/:id", updateHoliday);
router.delete("/:id", deleteHoliday);

export default router;