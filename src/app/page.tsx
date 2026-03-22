import { Workbench } from "@/components/workbench";
import { readDb } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await readDb();

  return (
    <main className="pageShell">
      <Workbench initialData={data} />
    </main>
  );
}
