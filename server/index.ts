//import "dotenv/config";
import dotenv from "dotenv";
dotenv.config();
import express from "express";
import type { Express, Request, Response } from "express";
//import express, { Express, Request, Response } from "express";
import { MongoClient } from "mongodb";
import { callAgent } from "./agent.js";
// to write custom AI agent function

const app: Express = express();

import cors from "cors";
app.use(
  cors({
    origin: "http://localhost:5173", // Your Vite frontend URL
    credentials: true,
  })
);
app.use(express.json());
//enable json parsing for incoming requests from frontend

// Debug: Check if .env is loading
console.log("Environment variables:", {
  MONGO_ATLAS_URI: process.env.MONGO_ATLAS_URI,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ? "LOADED" : "MISSING",
});
// Checks if MONGODB_URI exists
const MONGO_ATLAS_URI = process.env.MONGO_ATLAS_URI;
if (!MONGO_ATLAS_URI) {
  throw new Error("MONGODB_URI environment variable is required");
}
const client = new MongoClient(MONGO_ATLAS_URI as string);
//create a mongodb client using connection strings from environment  variables

//PROCESS>ENV helps access any file in dotenv file
async function startServer() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log("YOU Successfully connected to MongoDB!");
    app.get("/", (req: Request, res: Response) => {
      res.send("LangGraph Agent Server");
    });

    // To start a new conversation --Defining an endpoint
    //extract user message from request.body
    app.post("/chat", async (req: Request, res: Response) => {
      const initialMessage = req.body.message;
      const threadId = Date.now().toString();
      console.log(initialMessage);
      // Validate input
      if (!initialMessage || typeof initialMessage !== "string") {
        return res.status(400).json({ error: "Valid message is required" });
      }
      console.log("New conversation:", { threadId, initialMessage });
      try {
        const response = await callAgent(client, initialMessage, threadId);
        res.json({ threadId, response, status: "success" });
      } catch (error) {
        console.error("error starting conversation:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    //For continuing Existing Conversation
    app.post("/chat/:threadId", async (req: Request, res: Response) => {
      const { threadId } = req.params;
      const { message } = req.body;
      // Add validation for threadId
      if (!threadId) {
        return res.status(400).json({ error: "Thread ID is required" });
      }

      // Add validation for message
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }
      try {
        const response = await callAgent(client, message, threadId);
        res.json({
          response,
          threadId, // Return the threadId for consistency(ns bhi ho to theek hai..in video)
          status: "success",
        });
      } catch (error) {
        console.error("error in chat", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    const PORT = process.env.PORT || 8000;

    app.listen(PORT, () => {
      console.log(`Server runing on port ${PORT}`);
      console.log("Test endpoints:");
      console.log(`GET  http://localhost:${PORT}/`);
      console.log(`POST http://localhost:${PORT}/chat`);
      console.log(`POST http://localhost:${PORT}/chat/test-thread-123`);
    });
  } catch (error) {
    console.error("Error connecting to MongoDB: ", error);
    //then exit the process with error code 1
    process.exit(1);
  }
}

startServer();
