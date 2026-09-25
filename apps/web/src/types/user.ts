import type { User, UserSettings } from "@repo/api-contract";

/** The account's settings as the API returns them (`GET /auth/me`): the API contract's type. */
export type ApiUserSettings = UserSettings;

/** The signed-in user as the API returns it (`GET /auth/me`, and `user` of the login response): the API contract's type. */
export type ApiUser = User;
