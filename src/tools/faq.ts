import type { Env, FaqResult } from "../types";

export async function searchFaq(env: Env, query: string): Promise<FaqResult> {
  try {
    const embedding = await generateEmbedding(env, query);
    const searchResults = await env.VECTORIZE.query(embedding, {
      topK: 3,
      returnValues: false,
      returnMetadata: "all",
    });

    const bestMatch = searchResults.matches[0];
    if (!bestMatch) return { answer: "", score: 0 };

    const metadata = bestMatch.metadata as Partial<{
      question: string;
      answer: string;
    }>;
    const answer = metadata.answer || "";

    return {
      answer: bestMatch.score > 0.7 ? answer : "",
      question: metadata.question,
      score: bestMatch.score,
    };
  } catch (error) {
    console.error("FAQ search failed", error);
    return { answer: "", score: 0 };
  }
}

async function generateEmbedding(env: Env, query: string): Promise<number[]> {
  const model = env.WORKERS_AI_EMBEDDING_MODEL || "@cf/baai/bge-base-en-v1.5";
  const response = await env.AI.run(model as keyof AiModels, { text: query } as never);
  const data = response as { data?: number[][] };
  const embedding = data.data?.[0];
  if (!embedding) throw new Error("Embedding model returned no vector");
  return embedding;
}
