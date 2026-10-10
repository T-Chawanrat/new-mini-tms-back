import { getCurrentOilPrices } from "../../services/oil-price.js";

export const getOilPrices = async (req, res) => {
  try {
    const data = await getCurrentOilPrices();
    return res.json({ success: true, data });
  } catch (error) {
    console.error("getOilPrices error:", error);
    return res.status(502).json({ success: false, message: "ไม่สามารถโหลดราคาน้ำมันจาก PTT ได้" });
  }
};
