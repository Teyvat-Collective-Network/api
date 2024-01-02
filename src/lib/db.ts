import { ClientSession, Collection, Db, Document, MongoClient } from "mongodb";

export let _db: Db;
export let client: MongoClient;

export async function connect() {
    client = new MongoClient(Bun.env.DB_URI!);
    await client.connect();
    _db = client.db(Bun.env.DB_NAME || undefined);
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

export async function autoinc(sequence: string): Promise<number> {
    const doc = await db.counters.findOneAndUpdate({ sequence }, { $inc: { value: 1 } }, { upsert: true });
    return (doc?.value ?? 0) + 1;
}

export async function withSession(fn: (session: ClientSession) => any) {
    const session = client.startSession();

    try {
        return await session.withTransaction(fn);
    } finally {
        session.endSession();
    }
}

export function dbSession() {
    return client.startSession();
}
