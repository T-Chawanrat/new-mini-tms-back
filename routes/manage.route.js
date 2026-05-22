import express from "express";

import manageUserRoutes from "./manage.user.route.js";
import manageCustomerRoutes from "./manage.customer.route.js";
import manageVehicleRoutes from "./manage.vehicle.route.js";
import manageShipperRoutes from "./manage.shipper.route.js";
import manageRecipientRoutes from "./manage.recipient.route.js";
import managePackageRoutes from "./manage.package.route.js";

const router = express.Router();

router.use("/users", manageUserRoutes);
router.use("/customers", manageCustomerRoutes);
router.use("/vehicles", manageVehicleRoutes);
router.use("/shippers", manageShipperRoutes);
router.use("/recipients", manageRecipientRoutes);
router.use("/packages", managePackageRoutes);

export default router;