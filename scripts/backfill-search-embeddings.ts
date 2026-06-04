import { loadLocalEnv } from "../src/lib/bootstrap-env";
import { withDb } from "../src/lib/db";
import { embedTexts, toVectorLiteral } from "../src/lib/embeddings";

loadLocalEnv();

const BATCH_SIZE = Number(process.env.EMBED_BATCH_SIZE || "200");
const LIMIT = Number(process.env.EMBED_LIMIT || "0");

async function main() {
  await withDb(async (client) => {
    const rows = await client.query<{
      answer_id: string;
      search_text: string;
    }>(
      `select answer_id, search_text
       from search_documents
       where embedding is null
       order by answer_id asc
       ${LIMIT > 0 ? `limit ${LIMIT}` : ""}`,
    );

    let processed = 0;
    for (let start = 0; start < rows.rows.length; start += BATCH_SIZE) {
      const batch = rows.rows.slice(start, start + BATCH_SIZE);
      const vectors = await embedTexts(batch.map((row) => row.search_text));
      const params: string[] = [];
      const tuples: string[] = [];
      let bindIndex = 1;

      for (let index = 0; index < batch.length; index++) {
        const vector = vectors[index];
        if (!vector) continue;
        params.push(batch[index].answer_id, toVectorLiteral(vector));
        tuples.push(`($${bindIndex++}, $${bindIndex++}::vector)`);
      }

      if (tuples.length) {
        await client.query(
          `update search_documents as sd
           set embedding = values_table.embedding
           from (values ${tuples.join(", ")}) as values_table(answer_id, embedding)
           where sd.answer_id = values_table.answer_id`,
          params,
        );
      }

      processed += batch.length;
      console.log(`Embedded ${processed.toLocaleString()} / ${rows.rows.length.toLocaleString()} search documents`);
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
