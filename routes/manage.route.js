import express from "express";

import manageUserRoutes from "./manage.user.route.js";
import manageCustomerRoutes from "./manage.customer.route.js";
import manageVehicleRoutes from "./manage.vehicle.route.js";
import manageShipperRoutes from "./manage.shipper.route.js";
import manageRecipientRoutes from "./manage.recipient.route.js";
import managePackageRoutes from "./manage.package.route.js";

const router = express.Router();

router.use("/", manageUserRoutes);
router.use("/", manageCustomerRoutes);
router.use("/", manageVehicleRoutes);
router.use("/", manageShipperRoutes);
router.use("/", manageRecipientRoutes);
router.use("/", managePackageRoutes);

export default router;