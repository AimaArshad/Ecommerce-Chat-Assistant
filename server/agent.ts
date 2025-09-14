// agent.ts
// export async function callAgent(): Promise<any> {
//   // Your agent implementation here
//   console.log("Agent function called");
//   return { message: "Agent response" };
// }

import {
  GoogleGenerativeAIEmbeddings,
  ChatGoogleGenerativeAI,
} from "@langchain/google-genai";

import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
//helps create structured prompts
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { StateGraph, Annotation } from "@langchain/langgraph";
//stategraph helps with statebased workflow orchestration
import { tool } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
//for saving conversation states
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { Collection, MongoClient } from "mongodb";
import { z } from "zod";
import "dotenv/config";

// Defining this interface at the top of  file(to resolve error.status issues)
interface ErrorWithStatus extends Error {
  status?: number;
}

//this function handles API rate limits with exponential backoff
//(defines the max no. of retries: maxretries=3)
async function retryWithBackOff<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const err = error as ErrorWithStatus; // Type assertion
      if (err.status === 429 && attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        console.error(
          `Rate limit hit. Retrying in ${delay / 1000} seconds...`,
          err
        );
        await new Promise((resolve) => setTimeout(resolve, delay)); //Sets a timer that calls resolve after delay milliseconds
        //When resolve() is called, the promise is fulfilled
        continue;

        //delay/1000(converts milliseconds to seconds...max delay=30 sec)
      }
      throw err;
    }
  }

  throw new Error("Max retries exceeded");
}

//function to create and run the AI Agent
export async function callAgent(
  client: MongoClient,
  query: string,
  thread_id: string
) {
  try {
    const dbName = "inventory_database";
    const db = client.db(dbName); //get db instance
    const collections = db.collection("items"); //get db collection

    //graph state manages conversation history(conversation graph or message flow)
    //reducer combines old and new msgs
    const GraphState = Annotation.Root({
      messages: Annotation<BaseMessage[]>({
        reducer: (x, y) => x.concat(y),
      }),
    });

    ////custom tool for searching inventory
    const itemLookupTool = tool(
      async ({ query, n = 10 }) => {
        try {
          console.log("Item lookup tool called with query :", query);

          //checking if database has data
          const totalCount = await collections.countDocuments();
          console.log(`Total documents in collection :"${totalCount}`);
          if (totalCount === 0) {
            console.log("Collection is empty");
            return JSON.stringify({
              error: "No items found in inventory",
              message: "The inventory database appears to be empty",
              count: 0,
            });
          }

          const sampleDocs = await collections.find({}).limit(3).toArray();
          console.log("Sample documents:", sampleDocs);

          const dbConfig = {
            collection: collections,
            indexName: "vector_index",
            textKey: "embedding_text",
            embeddingKey: "embedding",
          };

          const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
          if (!GOOGLE_API_KEY) {
            throw new Error("GOOGLE_API_KEY environment variable is required");
          }
          //create a vector store instance for semantic search using Google Gemini Embeddings
          const vectorStore = new MongoDBAtlasVectorSearch(
            new GoogleGenerativeAIEmbeddings({
              apiKey: GOOGLE_API_KEY,
              model: "text-embedding-004",
            }),
            dbConfig
          );
          console.log("Performing vector Search....");
          const result = await vectorStore.similaritySearchWithScore(query, n);
          console.log(`Vector search returned ${result.length}results`);

          let textResults = []; // Declare outside the if block
          if (result.length === 0) {
            console.log(
              "Vector search returned no results, trying text search..."
            );

            //testing it with regex in mongodb database
            textResults = await collections
              .find({
                $or: [
                  { item_name: { $regex: query, $options: "i" } },
                  { item_description: { $regex: query, $options: "i" } },
                  { categories: { $regex: query, $options: "i" } },
                  { embedding_text: { $regex: query, $options: "i" } },
                ],
              })
              .limit(n)
              .toArray();
            console.log(`Text search returned ${textResults.length}results`);

            return JSON.stringify({
              results: textResults,
              searchType: "text",
              query: query,
              count: textResults.length,
            });
          }

          return JSON.stringify({
            results: result,
            searchType: "vector",
            query: query,
            count: result.length,
          });
        } catch (error) {
          console.error("Error in item lookup", error);
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";

          console.error("Error Details:", {
            message: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
            name: error instanceof Error ? error.name : undefined,
          });
          return JSON.stringify({
            error: "Failed to search inventory",
            details: errorMessage,
            query: query,
          });
        }
      },
      //defining metadeta and schema definition
      {
        name: "item_lookup",
        description:
          "Gathers furniture item details from the inventory database",
        schema: z.object({
          query: z.string().describe("The search query"),
          n: z
            .number()
            .optional()
            .default(10)
            .describe("Number of results to return"),
        }),
      }
    );
    //Array of all available tools
    const tools = [itemLookupTool];
    const toolNode = new ToolNode<typeof GraphState.State>(tools);

    const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
    if (!GOOGLE_API_KEY) {
      throw new Error("GOOGLE_API_KEY environment variable is required");
    }
    //to get humanlike responses//initialize the ai model

    const model = new ChatGoogleGenerativeAI({
      model: "generative-1.5-flash",
      temperature: 0,
      maxRetries: 0,
      apiKey: GOOGLE_API_KEY, //validated variable
    }).bindTools(tools);
    // to bind custom tools to the model

    // decision function
    function shouldContinue(state: typeof GraphState.State) {
      const messages = state.messages;
      const lastMessage = messages[messages.length - 1] as AIMessage;

      if (lastMessage.tool_calls?.length) {
        return "tools";
      }
      return "__end__";
    }

    //this function calls AI model with retry logic
    async function callModel(state: typeof GraphState.State) {
      // Before creating a structured prompt template, wrapping it in retry logic
      return retryWithBackOff(async () => {
        const prompt = ChatPromptTemplate.fromMessages([
          [
            "system",
            `You are a helpful E-commerce Chatbot Agent for a furniture store.

IMPORTANT: You have access to an item_lookup tool that searches the furniture inventory database.ALWAYS use this tool when customers ask about furniture items, even if the tool returns errors or empty results.
when using the item_lookup tool:
-If it returns results,provide helpful details abut the furniture items
-If it returns an error or no results,acknowledge this and offer to help in  other ways        
-If the database appears to be empty, let the customer know that inventory might be being updated         
Current time: {time}`,
          ],
          new MessagesPlaceholder("messages"),
        ]);
        const formattedPrompt = await prompt.formatMessages({
          time: new Date().toISOString(),
          messages: state.messages,
        });
        //call AI model with formatted prompt
        const result = await model.invoke(formattedPrompt);
        return { messages: [result] };
      });
    }
    //build the workflow graph//to allow us to initialize conversation state persistence
    const workflow = new StateGraph(GraphState)
      .addNode("agent", callModel)
      .addNode("tools", toolNode)
      .addEdge("__start__", "agent")
      .addConditionalEdges("agent", shouldContinue)
      .addEdge("tools", "agent");
    //starts workflow at agent //addEdge("__start__","agent").
    const checkpointer = new MongoDBSaver({ client, dbName });
    const app = workflow.compile({ checkpointer });

    const finalState = await app.invoke(
      {
        messages: [new HumanMessage(query)],
      },
      {
        recursionLimit: 15,
        configurable: { thread_id: thread_id }, //conversation thread identifier
      }
    );

    const response =
      finalState.messages[finalState.messages.length - 1]?.content;
    console.log("Agent response:", response);
    return response;
  } catch (error) {
    const err = error as ErrorWithStatus; //type assertion
    console.error("Error in callAgent", err.message);
    if (err.status === 429) {
      //rate limit error
      throw new Error(
        "Service temporarily unavailable due to rate limits.Please try again in a minute."
      );
    } else if (err.status === 401) {
      //authentication error
      throw new Error(
        "Authentication failed.Please check your API configuration."
      );
    } else {
      throw new Error(`Agent failed :${err.message}`);
    }
  }
}
