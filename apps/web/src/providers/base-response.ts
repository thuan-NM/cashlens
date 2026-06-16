export type BaseResponse<T> = {
    success: boolean;
    data: T | null;
    message: string;
    timestamp: string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

export const isBaseResponse = (value: unknown): value is BaseResponse<unknown> =>
    isObject(value) &&
    typeof value.success === "boolean" &&
    "data" in value &&
    typeof value.message === "string" &&
    typeof value.timestamp === "string";

export const unwrapBaseResponse = <T>(value: unknown): T => {
    if (isBaseResponse(value)) {
        return value.data as T;
    }

    return value as T;
};
