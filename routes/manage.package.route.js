import express from "express";
import {
  getPackages,
  getPackageById,
  createPackage,
  updatePackage,
  updatePackageStatus,
  createPackageDetail,
  updatePackageDetail,
  updatePackageDetailStatus,
} from "../controllers/manage.package.controller.js";
import { allow } from "../middlewares/allow.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

// PACKAGES
router.get("/", auth, getPackages);
router.get("/:id", auth, getPackageById);
router.post("/", auth, allow(1, 3, 4, 5, 10, 11), createPackage);
router.patch("/:id", auth, allow(1, 3, 4, 5, 10, 11), updatePackage);
router.patch("/:id/status", auth, allow(1, 3, 4, 5, 10, 11), updatePackageStatus);
router.post("/:id/details", auth, allow(1, 3, 4, 5, 10, 11), createPackageDetail);
router.patch("/:id/details/:detailId", auth, allow(1, 3, 4, 5, 10, 11), updatePackageDetail);
router.patch("/:id/details/:detailId/status", auth, allow(1, 3, 4, 5, 10, 11), updatePackageDetailStatus);

export default router;
