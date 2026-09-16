import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const testError = new Error("Jesus United Sentry Test Verification Event");

  try {
    Sentry.captureException(testError);
    // Give the event a chance to leave the process before the response is
    // returned - serverless runtimes can freeze right after responding.
    await Sentry.flush(2000);
  } catch (error) {
    // Never let monitoring failures break the endpoint.
    console.error("Sentry test event could not be sent", error);
  }

  return NextResponse.json({
    success: true,
    message: "Sentry test event sent successfully",
    timestamp: new Date().toISOString(),
  });
}