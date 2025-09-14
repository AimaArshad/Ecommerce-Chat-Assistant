//here using embeddings to compare similarity in words or phrases(cow jumped over the moon)

//so we have to  compare embeddings  against embeddings

//if we create embeddings using gemini , we cant compare it to one from OpenAI

import {
  ChatGoogleGenerativeAI,
  GoogleGenerativeAIEmbeddings,
} from "@langchain/google-genai";

//ensures AI returns data in the specific format
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { MongoClient } from "mongodb";
//for storing and searching embeddings
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
//for data scheme validation,type safety
import { z } from "zod";
import "dotenv/config";

const client = new MongoClient(process.env.MONGO_ATLAS_URI as string);
// Add this validation after imports

if (!process.env.GOOGLE_API_KEY) {
  throw new Error("GOOGLE_API_KEY environment variable is required");
}

//INITIALIZING GEMINI CHAT MODEL FOR GENERATING SYNTHETIC FURNITURE DATA
const llm = new ChatGoogleGenerativeAI({
  model: "gemini-1.5-flash",
  temperature: 0.7,
  apiKey: process.env.GOOGLE_API_KEY || "",
});
//TEMPERATURE MEANS CREATIVITY LEVEL

const itemSchema = z.object({
  item_id: z.string(),
  item_name: z.string(),
  item_description: z.string(),
  brand: z.string(),
  manufacture_address: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    postal_code: z.string(),
    country: z.string(),
  }),
  prices: z.object({
    full_price: z.number(),
    sale_price: z.number(),
  }),
  categories: z.array(z.string()),
  user_reviews: z.array(
    z.object({
      review_date: z.string(),
      rating: z.string(),
      comment: z.string(),
    })
  ),
  notes: z.string(),
});

//create a typescript type for itemSchema
type Item = z.infer<typeof itemSchema>;
//create a parser that ensures output  matches itemSchema
const parser = StructuredOutputParser.fromZodSchema(z.array(itemSchema));
//function to create databse and collection before seeding database
async function setupDatabaseAndCollection(): Promise<void> {
  console.log("Setting Up database and collection...");
  //creating reference to database
  const db = client.db("inventory_database");
  const collections = await db.listCollections({ name: "items" }).toArray();

  if (collections.length === 0) {
    await db.createCollection("items");
    console.log("Created 'items collection in 'inventory database' database");
  } else {
    console.log(
      "'items' collection already exists in inventory database' database"
    );
  }
}

// async function createVectorSearchIndex(): Promise<void> {
//   try {
//     const db = client.db("inventory_database");
//     const collection = db.collection("items");
//     await collection.dropIndexes();
//     const vectorSearchIdx = {
//       name: "vector_index",
//       type: "vectorSearch",
//       definition: {
//         fields: {
//           type: "vector",
//           path: "embedding",
//           numDimensions: 768,
//           similarity: "cosine",
//         },
//       },
//     };
//     console.log("Creating vector search index...");
//     await collection.createSearchIndex(vectorSearchIdx);
//     console.log("Successfully created vector search index");
//   } catch (error) {
//     console.error("Failed to create vector search index: ", error);
//   }
// }
/*
Issue 1: MongoDB Vector Search Index Error
Error: Value expected to be of type ARRAY is of unexpected type DOCUMENT

Fix: The vector search index definition is incorrect. Update your createVectorSearchIndex function:*/
async function createVectorSearchIndex(): Promise<void> {
  try {
    const db = client.db("inventory_database");
    const collection = db.collection("items");
    await collection.dropIndexes();
    const vectorSearchIdx = {
      name: "vector_index",
      type: "vectorSearch",
      definition: {
        fields: [
          {
            type: "vector",
            path: "embedding",
            numDimensions: 768,
            similarity: "cosine",
          },
        ],
      },
    };
    console.log("Creating vector search index...");
    await collection.createSearchIndex(vectorSearchIdx);
    console.log("Successfully created vector search index");
  } catch (error) {
    console.error("Failed to create vector search index: ", error);
  }
}

async function generateSyntheticData(): Promise<Item[]> {
  const prompt = `You are a helpful assistant that generates furniture store item data. Generate 10 furniture store items. Each record should store include the following fields: item_id,item_name, item_description,brand,manufacturer_address,prices,categories,user_reviews,notes. Ensure variety in the data and realistic values.
  
  
  ${parser.getFormatInstructions()}
  `;
  console.log("Generating synthetic data...");
  const response = await llm.invoke(prompt);
  //once we get response from above function, we then pass it into a structured array of item objects..<Item[]>(..as written in function definition..)
  return parser.parse(response.content as string);
}

//to create searchable text summary from furniture item data
async function createItemSummary(item: Item): Promise<string> {
  return new Promise((resolve) => {
    const manufacturerDetails = `Made in${item.manufacture_address.country}`;

    //joining all categories into a comma separated string(helping us write an item summary)
    const categories = item.categories.join(", ");
    //converting user reviews into an array in a readable text format
    const userReviews = item.user_reviews
      .map((review) => {
        `Rated ${review.rating} on ${review.review_date}: ${review.comment}`;
      })
      .join(" ");

    const basicInfo = `${item.item_name} ${item.item_description} from the brand ${item.brand}`;
    const price = `At full price it costs :${item.prices.full_price} USD, On sale it costs :${item.prices.sale_price} USD`;
    const notes = item.notes;

    const summary = `${basicInfo}. Manufacturer: ${manufacturerDetails}. Categories: ${categories}. Reviews: ${userReviews}. Price: ${price}. Notes:${notes}`;

    resolve(summary);
  });
}

async function seedDatabase(): Promise<void> {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });

    console.log("Successsfully connected to MongoDB");

    await setupDatabaseAndCollection();
    await createVectorSearchIndex();

    //define the database & colection again
    const db = client.db("inventory_database");
    const collection = db.collection("items");

    //clear any existing data in collection
    await collection.deleteMany({});
    console.log("Cleared Existing Data from items Collection");

    const syntheticData = await generateSyntheticData();

    const recordsWithSummaries = await Promise.all(
      syntheticData.map(async (record) => ({
        pageContent: await createItemSummary(record),
        metadata: { ...record }, //preserves the original item data
      }))
    );

    // Store each record with vector embeddings in mongoDB
    for (const record of recordsWithSummaries) {
      //creates vector embeddings and stores them in mongoDB atlas using gemini
      await MongoDBAtlasVectorSearch.fromDocuments(
        [record],
        new GoogleGenerativeAIEmbeddings({
          apiKey: process.env.GOOGLE_API_KEY || "",
          modelName: "text-embedding-004",
        }),
        {
          collection,
          indexName: "vector_index",
          textKey: "embedding_text",
          embeddingKey: "embedding",
        }
      );
      console.log(
        "Successfully processed & saved record: ",
        record.metadata.item_id
      );
    }
    console.log("Database seeding completed");
  } catch (error) {
    console.error("Error seeding the Database: ", error);
  } finally {
    await client.close();
  }
}

seedDatabase().catch(console.error);
