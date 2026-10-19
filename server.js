import fs from "fs";
import https from "https";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import morgan from "morgan";
// import authRoute from "./routes/";
import filterRoute from "./routes/admin/filter.routes.js";
// import labelRoute from "./routes/labelRoute.js";
import authRoute from "./routes/admin/auth.routes.js";
import manageRoutes from "./routes/admin/manage.route.js";
import receiveRoute from "./routes/admin/receive.route.js";
import createReceiveRoute from "./routes/admin/receive.create.routes.js";
import receiveImportRoutes from "./routes/admin/receive.import.routes.js";
import holidayRoutes from "./routes/admin/holiday.routes.js";
import receiveReportRoute from "./routes/admin/receive.report.route.js";
import labelRoute from "./routes/admin/label.route.js";
import warehouseReceiveRoutes from "./routes/admin/warehouse.receive.routes.js";
import productWarehouseRoutes from "./routes/admin/product.warehouse.routes.js";
import productTruckRoutes from "./routes/admin/product.truck.route.js";
import truckLoadRoutes from "./routes/admin/truck.route.js";
import driverTruckRoutes from "./routes/driver/driver.truck.route.js";
import driverDeliveryTruckRoutes from "./routes/driver/driver.delivery.truck.route.js";
import dcReceiveRoutes from "./routes/admin/dc.receive.routes.js";
import moveTkRoutes from "./routes/admin/move.tk.routes.js";
import moveDtRoutes from "./routes/admin/move.dt.routes.js";
import moveDcRoutes from "./routes/admin/move.dc.route.js";
import contractorRoutes from "./routes/admin/contractor.routes.js";
import driverAuthRoute from "./routes/driver/driver.auth.route.js";
import deliveryTruckRoutes from "./routes/admin/delivery.truck.route.js";
import deliveryCloseRoutes from "./routes/admin/delivery.close.route.js";
import deliveryCloseMediaRoutes from "./routes/admin/delivery.close.media.route.js";
import deliveryPendingReportRoutes from "./routes/admin/delivery.pending.report.route.js";
import deliveryIssueRoutes from "./routes/admin/delivery.issue.route.js";
import oilPriceRoutes from "./routes/admin/oil-price.route.js";
import announcementRoutes from "./routes/admin/announcement.route.js";
import logRoutes from "./routes/admin/log.route.js";
import { error } from "./middlewares/error.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(
  morgan("dev", {
    skip: (req, res) => {
      return req.url.startsWith("/uploads");
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/labels", express.static(path.join(__dirname, "labels")));

// app.use("/", authRoute);
app.use("/", filterRoute);
// app.use("/", labelRoute);
app.use("/", authRoute);
app.use("/manage", manageRoutes);
app.use("/receives", receiveRoute);
app.use("/create", createReceiveRoute);
app.use("/create", receiveImportRoutes);
app.use("/holidays", holidayRoutes);
app.use("/receive-report", receiveReportRoute);
app.use("/labels", labelRoute);
app.use("/warehouse-receives", warehouseReceiveRoutes);
app.use("/product-warehouses", productWarehouseRoutes);
app.use("/product-trucks", productTruckRoutes);
app.use("/truck-loads", truckLoadRoutes);
app.use("/driver/trucks", driverTruckRoutes);
app.use("/driver/delivery-trucks", driverDeliveryTruckRoutes);
app.use("/delivery-trucks", deliveryTruckRoutes);
app.use("/delivery-closes", deliveryCloseRoutes);
app.use("/delivery-close-media", deliveryCloseMediaRoutes);
app.use("/delivery-reports", deliveryPendingReportRoutes);
app.use("/delivery-issues", deliveryIssueRoutes);
app.use("/dc-receives", dcReceiveRoutes);
app.use("/move-tk", moveTkRoutes);
app.use("/move-dt", moveDtRoutes);
app.use("/move-dc", moveDcRoutes);
app.use("/contractors", contractorRoutes);
app.use("/oil-prices", oilPriceRoutes);
app.use("/announcements", announcementRoutes);
app.use("/logs", logRoutes);
app.use("/driver", driverAuthRoute);


app.use(error);

// const sslOptions = {
//   key: fs.readFileSync(
//     "/home/xsendwork/conf/web/xsendwork.com/ssl/xsendwork.com.key"
//   ),
//   cert: fs.readFileSync(
//     "/home/xsendwork/conf/web/xsendwork.com/ssl/xsendwork.com.crt"
//   ),
//   ca: fs.readFileSync(
//     "/home/xsendwork/conf/web/xsendwork.com/ssl/xsendwork.com.ca"
//   ),
// };

// const PORT = process.env.PORT || 8001;
// https.createServer(sslOptions, app).listen(PORT, () => {
//   console.log(`🚀 Server running on https://localhost:${PORT}`);
// });

const PORT = process.env.PORT || 8001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
