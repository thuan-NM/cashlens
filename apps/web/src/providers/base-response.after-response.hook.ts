import type { Hooks } from "ky";
import { unwrapBaseResponse } from "./base-response";

export const baseResponseAfterResponseHook: NonNullable<
    Hooks["afterResponse"]
>[number] = async (_request, _options, response) => {
    const contentType = response.headers.get("content-type");

    if (!contentType?.includes("application/json")) {
        return response;
    }

    const body = await response.clone().json().catch(() => undefined);
    const parsedBody = unwrapBaseResponse(body);

    if (parsedBody === body) {
        return response;
    }

    return new Response(JSON.stringify(parsedBody), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
};
