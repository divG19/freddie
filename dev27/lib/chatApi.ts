import { Client } from "@langchain/langgraph-sdk";

export const createClient = () =>
  new Client({
    apiUrl:
      typeof window !== "undefined"
        ? new URL("/api/langgraph", window.location.href).href
        : "http://127.0.0.1:3000/api/langgraph",
  });
