import fs from "fs";
import https from "https";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import morgan from "morgan";
import authRoute from "./routes/authRoute.js";
import billRoute from "./routes/billRoute.js";
import billsDataRoute from "./routes/billsDataRoute.js";
import filterRoute from "./routes/filterRoute.js";
import labelRoute from "./routes/labelRoute.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(morgan("dev"));
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/labels", express.static(path.join(__dirname, "labels")));

app.use("/", authRoute);
app.use("/", billRoute);
app.use("/", billsDataRoute);
app.use("/", filterRoute);
app.use("/", labelRoute);

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
