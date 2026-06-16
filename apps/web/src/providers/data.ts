import { createSimpleRestDataProvider } from "@refinedev/rest/simple-rest";
import { API_URL } from "./constants";
import { baseResponseAfterResponseHook } from "./base-response.after-response.hook";

export const { dataProvider, kyInstance } = createSimpleRestDataProvider({
    apiURL: API_URL,
    kyOptions: {
        hooks: {
            afterResponse: [baseResponseAfterResponseHook],
        },
    },
});
