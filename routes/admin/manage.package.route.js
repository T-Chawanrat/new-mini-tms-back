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
} from "../../controllers/admin/manage.package.controller.js";
import { auth } from "../../middlewares/auth.js";

const router = express.Router();

// PACKAGES
router.get("/", auth, getPackages);
router.get("/:id", auth, getPackageById);
router.post("/", auth, createPackage);
router.patch("/:id", auth, updatePackage);
router.patch("/:id/status", auth, updatePackageStatus);
router.post("/:id/details", auth, createPackageDetail);
router.patch("/:id/details/:detailId", auth, updatePackageDetail);
router.patch("/:id/details/:detailId/status", auth, updatePackageDetailStatus);

export default router;
