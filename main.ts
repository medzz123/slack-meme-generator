import express from "express";
import { WebClient } from "@slack/web-api";
import { Storage } from "@google-cloud/storage";
import { z } from "zod";
import sharp from "sharp";

const log = (...args: any[]) => {
  console.log(args.map((arg) => JSON.stringify(arg)).join(" "));
};

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const SLACK_BOT_TOKEN = process.env.BOT_TOKEN;

const storage = new Storage();

const bucket = storage.bucket("playter-meme-templates");

const slack = new WebClient(SLACK_BOT_TOKEN);

export const getParagraphs = (
  text: string,
  width: number,
  height: number
): { fontSize: number; paragraphs: { text: string; y: number }[] } => {
  const maxFontSize = Math.floor(width * 0.5);
  const targetHeight = Math.floor(height / 2);
  const words = text.split(" ");

  const measureText = (text: string, fontSize: number) => {
    return text.length * (fontSize * 0.6);
  };

  let fontSize = maxFontSize;
  let lines: string[] = [];
  let lineHeight = fontSize * 1.2;

  while (fontSize > 0) {
    let currentLine = "";
    lines = [];

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (measureText(testLine, fontSize) > width) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    lineHeight = fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;

    if (totalHeight <= targetHeight) {
      break;
    }

    fontSize--;
  }

  const yStart = height;

  const reverseLines = lines.slice().reverse();

  const paragraphs = reverseLines.map((line, index) => ({
    text: line,
    y: yStart - index * lineHeight,
  }));

  return {
    fontSize,
    paragraphs: paragraphs.reverse(),
  };
};

app.post("/generate", async (req, res) => {
  log("Received request in fun", req.body, req.headers);

  const parsed = z
    .object({
      channel_id: z.string(),
      text: z.string(),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    log("Failed to parse request", parsed.error);
    return res.status(400).send();
  }

  const { channel_id, text } = parsed.data;

  const [template, ...caption] = text.split(" ");

  const file = bucket.file(`${template}.png`);

  const [exists] = await file.exists();

  if (!exists) {
    log("File not found", template);
    return res.status(404).send("Image not found");
  }

  try {
    const [buffer] = await file.download();

    const image = sharp(buffer);
    const { width = 0, height = 0 } = await image.metadata();

    if (!width || !height) {
      log("Something is wrong with image, width, height is 0", template);
      return res.status(500).send("Failed to process image");
    }

    const { fontSize, paragraphs } = getParagraphs(
      caption.join(" ").toUpperCase(),
      width - 50,
      height - 50
    );

    const svgText = `
    <svg width="${width}" height="${height}">
    <defs>
    <style type="text/css">
    text {
        font-family: 'Impact', sans-serif;
        font-size: ${fontSize}px;
        font-weight: bold;
        text-transform: uppercase;
        fill: white;
        stroke: black;
        stroke-width: 10;
        paint-order: stroke;
      }
    </style>
    </defs>
    ${paragraphs.map(({ text, y }) => `<text x="50%" y="${y}" text-anchor="middle" dy="0.35em">${text}</text>`).join("\n")}
    </svg>
    `;

    const svgBuffer = Buffer.from(svgText);

    const newImageBuffer = await image
      .composite([{ input: svgBuffer, gravity: "south" }])
      .toBuffer();

    await slack.files.uploadV2({
      channel_id,
      file: newImageBuffer,
      filename: `meme-${new Date().valueOf()}.png`,
    });

    return res.status(200).send();
  } catch (error) {
    log("Failed to process request", error);
    return res.status(500).send();
  }
});

app.get("/health-check", (_, res) => {
  return res.status(200).send("OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
