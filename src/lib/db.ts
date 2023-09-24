import { Collection, Db, Document, MongoClient } from "mongodb";

export let _db: Db;
export let client: MongoClient;

export async function connect() {
    client = new MongoClient(Bun.env.DB_URI!);
    await client.connect();
    _db = client.db(Bun.env.DB_NAME);
}

const db = new Proxy(
    {},
    {
        get(_, property: string): Collection<Document> {
            return _db.collection(property);
        },
    },
) as Record<string, Collection<Document>>;

export default db;
