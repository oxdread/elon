import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET(req: NextRequest) {
  const addr = req.nextUrl.searchParams.get("addr");
  if (!addr) return new NextResponse("Not found", { status: 404 });

  const dir = path.join(process.cwd(), "public", "traders");
  for (const ext of ["png", "webp", "jpg", "jpeg"]) {
    const filePath = path.join(dir, `${addr}.${ext}`);
    if (fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      const ct = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      return new NextResponse(buffer, { headers: { "Content-Type": ct, "Cache-Control": "public, max-age=3600" } });
    }
  }
  return new NextResponse("Not found", { status: 404 });
}
