import fs from "fs";
import https from "https";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import morgan from "morgan";
// import authRoute from "./routes/";
import billRoute from "./routes/billRoute.js";
import billsDataRoute from "./routes/billsDataRoute.js";
import filterRoute from "./routes/filter.routes.js";
// import labelRoute from "./routes/labelRoute.js";
import authRoute from "./routes/auth.routes.js";
import manageRoutes from "./routes/manage.route.js";
import shipmentsRoute from "./routes/shipments.routes.js";
// import importRoutes from "./routes/import.routes.js";
import scanWarehouseRoutes from "./routes/scan.warehouse.routes.js";
import receiveRoute from "./routes/receive.route.js";
import createReceiveRoute from "./routes/receive.create.routes.js";
import receiveImportRoutes from "./routes/receive.import.routes.js";
import holidayRoutes from "./routes/holiday.routes.js";
import receiveReportRoute from "./routes/receive.report.route.js";
import labelRoute from "./routes/label.route.js";
import warehouseReceiveRoutes from "./routes/warehouse.receive.routes.js";

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
app.use("/", billRoute);
app.use("/", billsDataRoute);
app.use("/", filterRoute);
// app.use("/", labelRoute);
app.use("/", authRoute);
app.use("/manage", manageRoutes);
app.use("/shipments", shipmentsRoute);
// app.use("/import", importRoutes);
app.use("/scan", scanWarehouseRoutes);
app.use("/receives", receiveRoute);
app.use("/create", createReceiveRoute);
app.use("/create", receiveImportRoutes);
app.use("/holidays", holidayRoutes);
app.use("/receive-report", receiveReportRoute);
app.use("/labels", labelRoute);
app.use("/warehouse-receives", warehouseReceiveRoutes);

app.get("/test", (req, res) => {
  res.send("Backend is working!");
});

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
