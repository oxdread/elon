import { NextRequest, NextResponse } from "next/server";

const ADMIN_PASSWORD = "XoDread0909";

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    if (password === ADMIN_PASSWORD) {
      return NextResponse.json({ status: "ok" });
    }
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
