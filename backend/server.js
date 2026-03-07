import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { auditText } from "./audit.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.post("/audit", async (req, res) => {
  try {

    const { text } = req.body;

    if (!text) {
      return res.status(400).json({
        error: "No text provided"
      });
    }

    const result = await auditText(text);

    res.json(result);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Audit failed"
    });

  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("VeriAI backend running on port", PORT);
});