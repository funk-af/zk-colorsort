export function json(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export class HttpError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return json({ error: error.message, code: error.code }, error.status);
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  console.error(error);
  return json({ error: message }, 500);
}

export async function readJsonBody<T>(request: Request, maxBytes = 64_000): Promise<T> {
  const text = await request.text();
  if (text.length > maxBytes) {
    throw new HttpError(413, "Request body too large");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
}
