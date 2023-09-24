export function stripMongoIds(obj: any) {
    if (Array.isArray(obj)) obj.forEach(stripMongoIds);
    if (typeof obj === "object" && obj) {
        if ("_id" in obj) delete obj._id;
        Object.values(obj).forEach(stripMongoIds);
    }
}

export function trim(string: string) {
    return string
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .join("\n");
}
