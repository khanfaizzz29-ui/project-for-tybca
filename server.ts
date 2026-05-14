import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
const PORT = 3000;

// Multer setup for handling PDF uploads in memory
const upload = multer({ storage: multer.memoryStorage() });

// Gemini AI setup
const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

app.use(cors());
app.use(express.json());

// API route for evaluation
app.post('/api/evaluate', upload.single('projectReport'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Gemini API key is not configured' });
    }

    // Extract text from PDF
    const dataBuffer = req.file.buffer;
    const pdfParser = new PDFParse({ data: dataBuffer });
    const textResult = await pdfParser.getText();
    const text = textResult.text;

    if (!text || text.trim().length < 50) {
      return res.status(400).json({ error: 'The uploaded PDF seems to be empty or contains too little text.' });
    }

    // Evaluation Prompt based on the Black Book PDF requirements
    const prompt = `
      You are an expert academic evaluator. Analyze the following academic project report and provide a detailed evaluation across five dimensions:
      1. Originality: How unique is the concept and implementation?
      2. Technical Depth: What is the level of technical complexity and sophisticated knowledge demonstrated?
      3. Practical Relevance: How applicable is this project to real-world problems?
      4. Clarity: How well-structured and easy to understand is the report?
      5. Consistency: How well do the sections align with each other (e.g., Objectives vs Results)?

      Evaluate each dimension on a scale of 0 to 10.
      Provide a specific feedback summary for each dimension.
      Finally, calculate an overall score as the average of the five dimensions.

      Return the response in STRICT JSON format with this structure:
      {
        "scores": {
          "originality": number,
          "technicalDepth": number,
          "practicalRelevance": number,
          "clarity": number,
          "consistency": number
        },
        "feedback": {
          "originality": "string",
          "technicalDepth": "string",
          "practicalRelevance": "string",
          "clarity": "string",
          "consistency": "string"
        },
        "overallScore": number,
        "summary": "string",
        "title": "string (Detected title of the project)",
        "author": "string (Detected author name if found)"
      }

      Report Text:
      ${text.substring(0, 30000)}
    `;

    const response = await genAI.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error('Empty response from Gemini');
    }
    
    const evaluation = JSON.parse(responseText.trim());

    res.json(evaluation);
  } catch (error) {
    console.error('Error evaluating project:', error);
    res.status(500).json({ error: 'An error occurred during evaluation' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
