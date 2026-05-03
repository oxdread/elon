import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { query } from "@/lib/db";

function detectExt(buffer: Buffer): string {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "png";
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return "webp"; // RIFF
  return "jpg";
}

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
    const ext = detectExt(buffer);
    const dir = path.join(process.cwd(), "public", "traders");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Remove old files
    for (const e of ["jpg", "png", "webp"]) {
      const p = path.join(dir, `${addr}.${e}`);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    fs.writeFileSync(path.join(dir, `${addr}.${ext}`), buffer);
    // Update DB with correct extension
    await query("UPDATE tracked_wallets SET profile_image = $1 WHERE address = $2", [ext, addr]);

    return NextResponse.json({ status: "ok", ext });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
