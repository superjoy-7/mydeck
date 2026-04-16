import { NextResponse } from 'next/server';

// Debug endpoint: checks server-side env vars without leaking secrets.
// Returns only presence (true/false), never the actual values.
export async function GET() {
  const apiKey = process.env.OPENAI_API_KEY || '';
  const baseUrl = process.env.OPENAI_BASE_URL || '';
  const model = process.env.OPENAI_MODEL || '';

  return NextResponse.json({
    hasApiKey: !!apiKey,
    hasBaseUrl: !!baseUrl,
    hasModel: !!model,
    allConfigured: !!(apiKey && baseUrl && model),
    // Also report raw env names found — helps debug missing vars
    envKeys: {
      OPENAI_API_KEY: !!apiKey,
      OPENAI_BASE_URL: !!baseUrl,
      OPENAI_MODEL: !!model,
      NEXT_PUBLIC_OPENAI_API_KEY: !!process.env.NEXT_PUBLIC_OPENAI_API_KEY,
      NEXT_PUBLIC_OPENAI_BASE_URL: !!process.env.NEXT_PUBLIC_OPENAI_BASE_URL,
      NEXT_PUBLIC_OPENAI_MODEL: !!process.env.NEXT_PUBLIC_OPENAI_MODEL,
    },
  });
}
