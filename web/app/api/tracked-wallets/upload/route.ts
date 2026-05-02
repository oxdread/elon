import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const image = formData.get("image") as File | null;
    const address = formData.get("address") as string | null;

    if (!image || !address) {
      return NextResponse.json({ error: "Missing image or address" }, { status: 400 });
    }

    const addr = address.trim().toLowerCase();
    const buffer = Buffer.from(await image.arrayBuffer());
    const dir = path.join(process.cwd(), "public", "traders");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${addr}.jpg`), buffer);

    return NextResponse.json({ status: "ok" });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
