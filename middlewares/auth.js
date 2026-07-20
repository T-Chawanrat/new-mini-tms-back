import jwt from "jsonwebtoken";

export const auth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ message: "no token" });
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return res.status(401).json({ message: "invalid token format" });
    }

    const token = parts[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev_secret");

    req.user = decoded;

    next();
  } catch (err) {
    console.error("❌ VERIFY ERROR:", err.message);

    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "token expired" });
    }

    return res.status(401).json({ message: "invalid token" });
  }
};
