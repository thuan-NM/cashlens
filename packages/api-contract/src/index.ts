/**
 * @repo/api-contract: TypeScript types for the CashLens HTTP API, generated
 * from the API's OpenAPI document (src/generated/openapi.ts). Types only: no
 * runtime code, and no dependency on NestJS, Prisma, or API sources.
 *
 * The aliases below name the stable response schemas the web app consumes.
 * Add an alias here only for a schema the API documents with a response DTO
 * that its mapper declares as its return type.
 */
import type { components } from "./generated/openapi";

export type { components, operations, paths } from "./generated/openapi";

type Schemas = components["schemas"];

/** The success envelope with a typed `data` (BaseResponseInterceptor). */
export type Envelope<T> = Omit<Schemas["Envelope"], "data"> & { data: T };
/** The error body of every failure (ApiExceptionFilter). */
export type ApiErrorBody = Schemas["Error"];
/** The owner-scoped pagination wrapper used by list endpoints such as `GET /alerts`. */
export type Page<T> = { data: T[]; total: number; page: number; limit: number };

export type Alert = Schemas["Alert"];
export type AlertDelivery = Schemas["AlertDelivery"];
export type AlertSetting = Schemas["AlertSetting"];
export type AlertType = Schemas["AlertType"];
export type AlertSeverity = Schemas["AlertSeverity"];
export type AlertStatus = Schemas["AlertStatus"];
export type AlertDeliveryStatus = Schemas["AlertDeliveryStatus"];

export type EmailConnection = Schemas["EmailConnection"];
export type EmailConnectionStatus = Schemas["EmailConnectionStatus"];
export type EmailSyncRun = Schemas["EmailSyncRun"];
export type EmailSyncStatus = Schemas["EmailSyncStatus"];

export type Goal = Schemas["Goal"];
export type GoalFeasibility = Schemas["GoalFeasibility"];

export type Transaction = Schemas["Transaction"];
/** The financial account embedded in a transaction (serialized entity: money as decimal strings). */
export type TransactionAccount = Schemas["TransactionAccount"];
export type TransactionCategory = Schemas["TransactionCategory"];
/** `GET /transactions`: one page plus the eligible totals of the matching rows. */
export type TransactionPage = Schemas["TransactionPage"];
export type TotalsSummary = Schemas["TotalsSummary"];
export type CurrencyTotals = Schemas["CurrencyTotals"];

export type DashboardOverview = Schemas["DashboardOverview"];
export type CashflowMonth = Schemas["CashflowMonth"];
export type CategoryBreakdownRow = Schemas["CategoryBreakdownRow"];
export type HotBudget = Schemas["HotBudget"];
/** A deterministic, rule-based dashboard insight (not an AI-generated one). */
export type DashboardInsight = Schemas["DashboardInsight"];

export type User = Schemas["UserResponseDto"];
export type UserSettings = Schemas["UserSettingsResponseDto"];
