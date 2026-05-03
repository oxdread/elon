import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import fs from "fs";
import path from "path";

export async function GET() {
  try {
    const { rows } = await query(
      "SELECT id, address, name, profile_image, added_at FROM tracked_wallets ORDER BY added_at"
    );
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { address, action } = body;

    if (!address) return NextResponse.json({ error: "No address" }, { status: 400 });

    const addr = address.trim().toLowerCase();

    // Remove wallet
    if (action === "remove") {
      await query("DELETE FROM top_trader_trades WHERE wallet_address = $1", [addr]);
      await query("DELETE FROM tracked_wallets WHERE address = $1", [addr]);
      try {
        const dir = path.join(process.cwd(), "public", "traders");
        for (const ext of ["jpg", "png", "webp"]) {
          const imgPath = path.join(dir, `${addr}.${ext}`);
          if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
        }
      } catch {}
      return NextResponse.json({ status: "ok" });
    }

    // Update wallet name
    if (action === "update") {
      const newName = body.name || addr.slice(0, 8);
      await query("UPDATE tracked_wallets SET name = $1 WHERE address = $2", [newName, addr]);
      return NextResponse.json({ status: "ok" });
    }

    // Add wallet — try to scrape profile from Polymarket page
    let name = body.name || addr.slice(0, 8);
    let profileImage = "";
    const username = body.username || "";

    // If username provided, scrape profile from polymarket.com/@username
    if (username) {
      try {
        const pageRes = await fetch(`https://polymarket.com/@${username}`);
        if (pageRes.ok) {
          const html = await pageRes.text();
          const imgMatch = html.match(/"profileImage":"([^"]+)"/);
          if (imgMatch) profileImage = imgMatch[1];
          if (!body.name) {
            const nameMatch = html.match(/"username":"([^"]+)"/);
            if (nameMatch) name = nameMatch[1];
          }
        }
      } catch {}
    }

    // Download profile image
    if (profileImage) {
      try {
        const imgRes = await fetch(profileImage);
        if (imgRes.ok) {
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          const dir = path.join(process.cwd(), "public", "traders");
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          // Detect extension from content-type or URL
          const ct = imgRes.headers.get("content-type") || "";
          const ext = ct.includes("webp") ? "webp" : ct.includes("png") ? "png" : "jpg";
          // Save with correct extension and also save the extension in DB
          fs.writeFileSync(path.join(dir, `${addr}.${ext}`), buffer);
          profileImage = ext; // store just the extension
        }
      } catch {}
    }

    // Save to DB
    const now = Math.floor(Date.now() / 1000);
    await query(
      `INSERT INTO tracked_wallets (address, name, profile_image, added_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (address) DO UPDATE SET name = $2, profile_image = $3`,
      [addr, name, profileImage, now]
    );

    return NextResponse.json({ status: "ok", name, profileImage: profileImage ? `/traders/${addr}.jpg` : "" });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
