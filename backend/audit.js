import axios from "axios";

const CLAUDE_API = "https://api.anthropic.com/v1/messages";
const TAVILY_API = "https://api.tavily.com/search";

export async function auditText(text) {

  const claims = await extractClaims(text);

  const verifiedClaims = await verifyClaims(claims);

  const overall =
    verifiedClaims.reduce((sum, c) => sum + c.score, 0) /
    verifiedClaims.length;

  return {
    overall: Math.round(overall),
    claims: verifiedClaims
  };

}

async function extractClaims(text) {

  const response = await axios.post(
    CLAUDE_API,
    {
      model: "claude-3-haiku-20240307",
      max_tokens: 800,
      messages: [
        {
          role: "user",
          content: `Extract factual claims from this text:

${text}

Return JSON array with claim text.`
        }
      ]
    },
    {
      headers: {
        "x-api-key": process.env.CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01"
      }
    }
  );

  const raw = response.data.content[0].text;

  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }

}

async function verifyClaims(claims) {

  const results = [];

  for (const claim of claims) {

    const search = await axios.post(
      TAVILY_API,
      {
        query: claim.text,
        max_results: 3
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.TAVILY_API_KEY}`
        }
      }
    );

    const sources = search.data.results;

    const score = sources.length > 0 ? 80 : 40;

    const color =
      score >= 75 ? "green" :
      score >= 40 ? "yellow" :
      "red";

    results.push({
      text: claim.text,
      score,
      color,
      verdict: score > 70
        ? "Verified by sources"
        : "Uncertain claim",
      sourceUrl: sources[0]?.url
    });

  }

  return results;

}