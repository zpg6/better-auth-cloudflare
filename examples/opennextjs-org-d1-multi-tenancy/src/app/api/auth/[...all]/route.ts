import { initAuth } from "@/auth";

export async function POST(req: Request) {
    const auth = await initAuth();
    return auth.handler(req);
}

export async function GET(req: Request) {
    const auth = await initAuth();
    return auth.handler(req);
}
