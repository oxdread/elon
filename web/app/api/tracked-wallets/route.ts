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
      await query("DELETE FROM tracked_wallets WHERE address = $1", [addr]);
      // Delete image
      try {
        const imgPath = path.join(process.cwd(), "public", "traders", `${addr}.jpg`);
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
      } catch {}
      return NextResponse.json({ status: "ok" });
    }

    // Add wallet — fetch profile from Gamma API
    let name = addr.slice(0, 8);
    let profileImage = "";

    try {
      const profileRes = await fetch(`https://gamma-api.polymarket.com/profiles/${addr}`);
      if (profileRes.ok) {
        const profile = await profileRes.json();
        name = profile.name || profile.pseudonym || profile.username || name;
        profileImage = profile.profileImage || profile.pfp || "";
      }
    } catch {}

    // Download profile image
    if (profileImage) {
      try {
        const imgRes = await fetch(profileImage);
        if (imgRes.ok) {
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          const dir = path.join(process.cwd(), "public", "traders");
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, `${addr}.jpg`), buffer);
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
