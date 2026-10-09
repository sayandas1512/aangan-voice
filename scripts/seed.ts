import { getDb } from "@/lib/db/client";
import { designers } from "@/lib/db/schema";

// Placeholder designers per DECISIONS.md item 7 — replace with real names,
// Cal.com host IDs, and Telegram chat IDs once supplied.
const PLACEHOLDER_DESIGNERS = [
  { name: "Asha", calcomHostId: "placeholder-asha", telegramChatId: null, active: true },
  { name: "Rohan", calcomHostId: "placeholder-rohan", telegramChatId: null, active: true },
];

async function main() {
  const db = getDb();
  for (const d of PLACEHOLDER_DESIGNERS) {
    await db.insert(designers).values(d);
    console.log(`Seeded designer: ${d.name}`);
  }
  console.log("Seed complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
