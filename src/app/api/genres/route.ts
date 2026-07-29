import { TARGET_GENRES } from "@/lib/rakuten/genres";

export async function GET() {
  return Response.json({ genres: TARGET_GENRES });
}
