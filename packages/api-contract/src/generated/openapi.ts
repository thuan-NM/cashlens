/**
 * GENERATED FILE. Do not edit by hand.
 * Source: apps/api/docs/swagger.json (yarn workspace api swagger:generate).
 * Regenerate: yarn workspace @repo/api-contract generate
 */

export interface paths {
    "/api/alerts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AlertsController_list"];
        put?: never;
        post: operations["AlertsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/alerts/{id}/dismiss": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** ACTIVE -> DISMISSED, marking it read; 409 when resolved (ALERT-010). */
        patch: operations["AlertsController_dismiss"];
        trace?: never;
    };
    "/api/alerts/{id}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["AlertsController_markRead"];
        trace?: never;
    };
    "/api/alerts/read-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["AlertsController_markAllRead"];
        trace?: never;
    };
    "/api/alerts/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AlertsController_settings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["AlertsController_updateSetting"];
        trace?: never;
    };
    "/api/alerts/unread-count": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** ALERT-004: unread alerts, whatever their lifecycle status. */
        get: operations["AlertsController_unreadCount"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/analytics/cashflow": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AnalyticsController_cashflow"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/analytics/category-breakdown": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AnalyticsController_categoryBreakdown"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/analytics/monthly-summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AnalyticsController_monthlySummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController_login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController_logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/logout-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController_logoutAll"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuthController_me"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController_refresh"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController_register"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/bank-providers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["BankProvidersController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/budgets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["BudgetsController_list"];
        put?: never;
        post: operations["BudgetsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/budgets/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["BudgetsController_findById"];
        put?: never;
        post?: never;
        delete: operations["BudgetsController_archive"];
        options?: never;
        head?: never;
        patch: operations["BudgetsController_update"];
        trace?: never;
    };
    "/api/budgets/{id}/recalculate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Re-evaluates the budget alert conditions now (BUDGET-003). */
        post: operations["BudgetsController_recalculate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/budgets/alerts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["BudgetsController_alerts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/budgets/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["BudgetsController_summary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/classification-rules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ClassificationRulesController_list"];
        put?: never;
        post: operations["ClassificationRulesController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/classification-rules/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["ClassificationRulesController_remove"];
        options?: never;
        head?: never;
        patch: operations["ClassificationRulesController_update"];
        trace?: never;
    };
    "/api/dashboard/cashflow": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DashboardController_cashflow"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/dashboard/category-breakdown": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DashboardController_categoryBreakdown"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/dashboard/hot-budgets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DashboardController_hotBudgets"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/dashboard/insights": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DashboardController_insights"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/dashboard/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DashboardController_overview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/dashboard/recent-transactions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DashboardController_recentTransactions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/email-connections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["EmailConnectionsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/email-connections/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["EmailConnectionsController_disconnect"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/email-connections/{id}/sync": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["EmailIngestionController_sync"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/email-connections/{id}/sync-runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["EmailIngestionController_listRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/email-connections/gmail/callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The OAuth redirect target, session-issuing: HTTPS only in production.
         *     A browser navigation (Accept: text/html) is sent back to the web app's
         *     Email page with a fixed outcome; an API client gets the enveloped
         *     connection, or the error body, as before.
         */
        get: operations["EmailConnectionsController_callback"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/email-connections/gmail/connect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["EmailConnectionsController_connectGmail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/email-listen-rules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["EmailListenRulesController_list"];
        put?: never;
        post: operations["EmailListenRulesController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/email-listen-rules/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["EmailListenRulesController_remove"];
        options?: never;
        head?: never;
        patch: operations["EmailListenRulesController_update"];
        trace?: never;
    };
    "/api/email-messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["EmailIngestionController_listMessages"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/email-messages/{id}/parse": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ParserController_parse"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/email-messages/{id}/parser-runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ParserController_listRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/financial-accounts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FinancialAccountsController_list"];
        put?: never;
        post: operations["FinancialAccountsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/financial-accounts/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FinancialAccountsController_findById"];
        put?: never;
        post?: never;
        delete: operations["FinancialAccountsController_archive"];
        options?: never;
        head?: never;
        patch: operations["FinancialAccountsController_update"];
        trace?: never;
    };
    "/api/goals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GoalsController_list"];
        put?: never;
        post: operations["GoalsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/goals/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GoalsController_findById"];
        put?: never;
        post?: never;
        delete: operations["GoalsController_archive"];
        options?: never;
        head?: never;
        patch: operations["GoalsController_update"];
        trace?: never;
    };
    "/api/goals/{id}/contribution": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["GoalsController_contribute"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/goals/{id}/simulation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Enveloped `GoalFeasibility`; side-effect free (never touches alerts). */
        get: operations["GoalsController_simulate"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["HealthController_live"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/health/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["HealthController_ready"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/parser-templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ParserController_listTemplates"];
        put?: never;
        post: operations["ParserController_createTemplate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/parser-templates/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["ParserController_updateTemplate"];
        trace?: never;
    };
    "/api/transaction-categories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TransactionCategoriesController_list"];
        put?: never;
        post: operations["TransactionCategoriesController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/transaction-categories/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TransactionCategoriesController_findById"];
        put?: never;
        post?: never;
        delete: operations["TransactionCategoriesController_archive"];
        options?: never;
        head?: never;
        patch: operations["TransactionCategoriesController_update"];
        trace?: never;
    };
    "/api/transactions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TransactionsController_list"];
        put?: never;
        post: operations["TransactionsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/transactions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TransactionsController_findById"];
        put?: never;
        post?: never;
        delete: operations["TransactionsController_delete"];
        options?: never;
        head?: never;
        patch: operations["TransactionsController_update"];
        trace?: never;
    };
    "/api/transactions/{id}/category": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["TransactionsController_updateCategory"];
        trace?: never;
    };
    "/api/transactions/{id}/category-history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TransactionsController_categoryHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/transactions/{id}/duplicate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["TransactionsController_markDuplicate"];
        trace?: never;
    };
    "/api/transactions/{id}/ignore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["TransactionsController_ignore"];
        trace?: never;
    };
    "/api/transactions/{id}/reclassify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Applies the rules now, replacing a manual category if there is one
         *     (CLASS-006). The client warns before calling it; the body must be empty.
         */
        post: operations["TransactionsController_reclassify"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["UsersController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["UsersController_findById"];
        put?: never;
        post?: never;
        delete: operations["UsersController_deleteById"];
        options?: never;
        head?: never;
        patch: operations["UsersController_updateById"];
        trace?: never;
    };
    "/api/users/list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["UsersController_list"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["UsersController_findMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["UsersController_updateMe"];
        trace?: never;
    };
    "/api/users/me/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["UsersController_updateMySettings"];
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        AdminUserResponseDto: {
            baseCurrency: string;
            /** Format: date-time */
            createdAt: string;
            email: string;
            fullName: string | null;
            id: string;
            /** Format: date-time */
            lastLoginAt: string | null;
            locale: string;
            role: string;
            status: string;
            timezone: string;
            /** Format: date-time */
            updatedAt: string;
        };
        Alert: {
            /** @description null for legacy and user-authored alerts */
            conditionKey: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            dismissedAt: string | null;
            /** @description null for legacy and user-authored alerts (no delivery row) */
            emailDelivery: components["schemas"]["AlertDelivery"] | null;
            id: string;
            isRead: boolean;
            message: string;
            metadata: {
                [key: string]: unknown;
            } | null;
            observedValue: number | null;
            /** Format: date-time */
            periodEnd: string | null;
            /** Format: date-time */
            periodStart: string | null;
            /** Format: date-time */
            readAt: string | null;
            resolutionReason: string | null;
            /** Format: date-time */
            resolvedAt: string | null;
            resourceId: string | null;
            resourceType: string | null;
            severity: components["schemas"]["AlertSeverity"];
            status: components["schemas"]["AlertStatus"];
            thresholdValue: number | null;
            title: string;
            /** Format: date-time */
            triggeredAt: string;
            type: components["schemas"]["AlertType"];
            userId: string;
        };
        AlertDelivery: {
            attemptCount: number;
            channel: components["schemas"]["AlertDeliveryChannel"];
            /** @description For example TIMEOUT, AUTH, REJECTED, INTERRUPTED */
            failureCode: string | null;
            /** Format: date-time */
            lastAttemptAt: string | null;
            /** Format: date-time */
            sentAt: string | null;
            /** @enum {string|null} */
            skipReason: "NOT_CRITICAL" | "EMAIL_DISABLED" | "NOTIFICATIONS_DISABLED" | "TRANSPORT_DISABLED" | null;
            status: components["schemas"]["AlertDeliveryStatus"];
        };
        /** @enum {string} */
        AlertDeliveryChannel: "EMAIL" | "IN_APP";
        /** @enum {string} */
        AlertDeliveryStatus: "PENDING" | "SENT" | "SKIPPED" | "FAILED";
        AlertSetting: {
            /** Format: date-time */
            createdAt: string;
            /** @description false when the deployment runs with email delivery disabled */
            emailAvailable: boolean;
            emailEnabled: boolean;
            id: string;
            inAppEnabled: boolean;
            metadata: {
                [key: string]: unknown;
            } | null;
            threshold: number | null;
            type: components["schemas"]["AlertType"];
            /** Format: date-time */
            updatedAt: string;
            userId: string;
        };
        /** @enum {string} */
        AlertSeverity: "INFO" | "WARNING" | "CRITICAL";
        /** @enum {string} */
        AlertStatus: "ACTIVE" | "DISMISSED" | "RESOLVED";
        /** @enum {string} */
        AlertType: "BUDGET_THRESHOLD" | "LARGE_TRANSACTION" | "CATEGORY_SHIFT" | "GOAL_RISK" | "CASHFLOW_RISK" | "PARSER_ISSUE" | "SYSTEM";
        AuthResponseDto: {
            user: components["schemas"]["UserResponseDto"];
        };
        CreateAlertDto: {
            message: string;
            metadata?: Record<string, never>;
            resourceId?: string;
            resourceType?: string;
            /** @enum {string} */
            severity?: "INFO" | "WARNING" | "CRITICAL";
            title: string;
            /** @enum {string} */
            type: "SYSTEM" | "BUDGET_THRESHOLD" | "LARGE_TRANSACTION" | "CATEGORY_SHIFT" | "GOAL_RISK" | "CASHFLOW_RISK" | "PARSER_ISSUE";
        };
        CreateBudgetDto: {
            amount: number;
            categoryId?: string;
            currency?: string;
            endsAt?: string;
            isActive?: boolean;
            metadata?: Record<string, never>;
            name: string;
            /** @enum {string} */
            period?: "WEEKLY" | "MONTHLY" | "YEARLY" | "CUSTOM";
            rollover?: boolean;
            startsAt: string;
            /**
             * @description The warning threshold, 1–99 (BUDGET-001); critical is fixed at 100 and
             *     not writable. Stored legacy values of 100 or more are kept but can no
             *     longer be written.
             */
            thresholdPercent?: number;
        };
        CreateClassificationRuleDto: {
            bankName?: string | null;
            categoryId: string;
            descriptionPattern?: string | null;
            /** @enum {string|null} */
            direction?: "INCOME" | "EXPENSE" | "TRANSFER_IN" | "TRANSFER_OUT" | "ADJUSTMENT" | null;
            isActive?: boolean;
            merchantPattern?: string | null;
            priority?: number;
        };
        CreateEmailListenRuleDto: {
            bankProviderId?: string;
            bodyContains?: string;
            emailConnectionId?: string;
            isEnabled?: boolean;
            name: string;
            priority?: number;
            senderDomain?: string;
            senderEmail?: string;
            subjectContains?: string;
            syncFromDate?: string;
        };
        CreateFinancialAccountDto: {
            accountMask?: string;
            bankProviderId?: string;
            creditLimit?: number;
            currency?: string;
            currentBalance?: number;
            institutionName?: string;
            isDefault?: boolean;
            metadata?: Record<string, never>;
            name: string;
            openingBalance?: number;
            /** @enum {string} */
            status?: "ACTIVE" | "INACTIVE" | "ARCHIVED" | "CLOSED";
            /** @enum {string} */
            type?: "BANK_ACCOUNT" | "CHECKING" | "SAVINGS" | "CREDIT_CARD" | "CASH" | "E_WALLET" | "INVESTMENT" | "OTHER";
        };
        CreateGoalDto: {
            currency?: string;
            metadata?: Record<string, never>;
            months?: number;
            name: string;
            /** @enum {string} */
            priority?: "CRITICAL" | "LOW" | "MEDIUM" | "HIGH";
            savedAmount?: number;
            /** @enum {string} */
            status?: "ACTIVE" | "ARCHIVED" | "PAUSED" | "COMPLETED";
            targetAmount: number;
            targetDate?: string | null;
            type?: string;
        };
        CreateParserTemplateDto: {
            bankProviderId: string;
            bodyPattern?: string;
            /** @enum {string} */
            channel?: "EMAIL" | "CSV" | "SMS" | "API";
            /** @enum {string} */
            directionHint?: "INCOME" | "EXPENSE" | "TRANSFER_IN" | "TRANSFER_OUT" | "ADJUSTMENT";
            fields: components["schemas"]["ParserFieldDto"][];
            isActive?: boolean;
            language?: string;
            name: string;
            priority?: number;
            subjectPattern?: string;
            version: number;
        };
        CreateTransactionCategoryDto: {
            color?: string;
            excludeFromAnalytics?: boolean;
            excludeFromBudget?: boolean;
            icon?: string;
            metadata?: Record<string, never>;
            name: string;
            parentId?: string;
            slug?: string;
            sortOrder?: number;
            /** @enum {string} */
            type?: "INCOME" | "EXPENSE" | "TRANSFER" | "NEUTRAL";
        };
        CreateTransactionDto: {
            amount: number;
            categoryId?: string;
            counterpartyName?: string;
            currency?: string;
            description?: string;
            /** @enum {string} */
            direction: "INCOME" | "EXPENSE" | "TRANSFER_IN" | "TRANSFER_OUT" | "ADJUSTMENT";
            duplicateOfTransactionId?: string;
            feeAmount?: number;
            financialAccountId?: string;
            /** @description Must agree with duplicateOfTransactionId; see TransactionsService. */
            isDuplicate?: boolean;
            merchantName?: string;
            metadata?: Record<string, never>;
            postedDate?: string;
            /** @enum {string} */
            status?: "PENDING" | "POSTED" | "IGNORED" | "NEEDS_REVIEW";
            transactionTime: string;
            userNote?: string;
        };
        CreateUserDto: {
            baseCurrency?: string;
            /** Format: email */
            email: string;
            fullName?: string;
            locale?: string;
            metadata?: Record<string, never>;
            /** @enum {string} */
            role?: "USER" | "ADMIN";
            /** @enum {string} */
            status?: "ACTIVE" | "DISABLED" | "PENDING_DELETE";
            timezone?: string;
        };
        EmailConnection: {
            /** Format: date-time */
            backfillCompletedAt: string | null;
            /** Format: date-time */
            backfillFrom: string | null;
            /** Format: date-time */
            connectedAt: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            disconnectedAt: string | null;
            emailAddress: string;
            errorMessage: string | null;
            id: string;
            /** Format: date-time */
            lastFailedAt: string | null;
            /** Format: date-time */
            lastSyncedAt: string | null;
            provider: components["schemas"]["EmailProvider"];
            providerUserId: string | null;
            reconnectRequired: boolean;
            /** @enum {string} */
            recoveryAction: "NONE" | "RETRY" | "RECONNECT" | "CONNECT";
            scopes: string[];
            status: components["schemas"]["EmailConnectionStatus"];
            /** @description True while an unexpired sync lease exists */
            syncInProgress: boolean;
            /** Format: date-time */
            tokenExpiresAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        /** @enum {string} */
        EmailConnectionStatus: "ACTIVE" | "EXPIRED" | "REVOKED" | "ERROR";
        /** @enum {string} */
        EmailProvider: "GMAIL" | "OUTLOOK" | "IMAP";
        EmailSyncRun: {
            /** Format: date-time */
            createdAt: string;
            emailConnectionId: string;
            emailsFailed: number;
            emailsFound: number;
            emailsMatched: number;
            emailsParsed: number;
            /** @description Sanitized failure summary */
            errorMessage: string | null;
            /** Format: date-time */
            finishedAt: string | null;
            /** @description True when a non-FAILED run left work in the current window; the next manual sync continues it */
            hasMore: boolean;
            id: string;
            /** Format: date-time */
            startedAt: string;
            status: components["schemas"]["EmailSyncStatus"];
            transactionsCreated: number;
            triggerType: components["schemas"]["EmailSyncTriggerType"];
        };
        /** @enum {string} */
        EmailSyncStatus: "RUNNING" | "SUCCESS" | "PARTIAL_FAILED" | "FAILED" | "EXPIRED";
        /** @enum {string} */
        EmailSyncTriggerType: "MANUAL" | "SCHEDULED" | "WEBHOOK" | "BACKFILL";
        Envelope: {
            /** @description Per-request id, also sent as the x-correlation-id header */
            correlationId?: string;
            /** @description The response payload */
            data: Record<string, never>;
            /** @example Success */
            message: string;
            /** @example true */
            success: boolean;
            /** Format: date-time */
            timestamp: string;
        };
        Error: {
            /** @example NOT_FOUND */
            code: string;
            correlationId: string;
            /** @description HTTP reason phrase */
            error?: string;
            /** @description Validation messages per request field (VALIDATION_FAILED) */
            fields?: {
                [key: string]: string[];
            };
            message: string | string[];
            /** @example 404 */
            statusCode: number;
        };
        Goal: {
            /** Format: date-time */
            createdAt: string;
            currency: string;
            id: string;
            metadata: {
                [key: string]: unknown;
            } | null;
            months: number | null;
            name: string;
            priority: components["schemas"]["GoalPriority"];
            progressPercent: number;
            /** @description max(0, target − saved), exact */
            remainingAmount: number;
            savedAmount: number;
            status: components["schemas"]["GoalStatus"];
            targetAmount: number;
            /** Format: date-time */
            targetDate: string | null;
            type: string | null;
            /** Format: date-time */
            updatedAt: string;
            userId: string;
        };
        GoalContributionDto: {
            amount: number;
            note?: string;
        };
        GoalFeasibility: {
            /** @description null when INSUFFICIENT_DATA */
            availableMonthlyCashflow: number | null;
            /** @description null when INSUFFICIENT_DATA */
            feasibilityScore: number | null;
            goalId: string;
            /** @enum {string} */
            horizonSource: "QUERY" | "TARGET_DATE" | "GOAL_MONTHS" | "DEFAULT";
            monthlyRequired: number;
            /** @description User months from the current one through the deadline month */
            months: number;
            monthsRequired: number;
            /**
             * @example [
             *       "2026-06",
             *       "2026-07",
             *       "2026-08"
             *     ]
             */
            observationMonths: string[];
            pastDeadline: boolean;
            /** @description Comma-separated reason codes */
            reason: string;
            remainingAmount: number;
            savedAmount: number;
            scenario: components["schemas"]["GoalScenarioType"];
            /** @enum {string} */
            status: "SAFE" | "ACCEPTABLE" | "RISKY" | "NOT_RECOMMENDED" | "INSUFFICIENT_DATA";
            targetAmount: number;
            /** @description Equals remainingAmount */
            totalCost: number;
        };
        /** @enum {string} */
        GoalPriority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
        /** @enum {string} */
        GoalScenarioType: "FULL" | "INSTALLMENT";
        /** @enum {string} */
        GoalStatus: "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";
        ListFilterDto: {
            field: string;
            /** @enum {string} */
            operator: "eq" | "ne" | "contains" | "startswith" | "endswith" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "null" | "nnull";
            value?: Record<string, never>;
        };
        ListQueryDto: {
            /** @default 1 */
            currentPage: number;
            filters?: components["schemas"]["ListFilterDto"][];
            /** @default 20 */
            pageSize: number;
            search?: string;
            sorters?: components["schemas"]["ListSorterDto"][];
        };
        ListSorterDto: {
            field: string;
            /** @enum {string} */
            order: "asc" | "desc";
        };
        LoginDto: {
            /** Format: email */
            email: string;
            password: string;
        };
        MarkDuplicateDto: {
            duplicateOfTransactionId?: string | null;
        };
        ParserFieldDto: {
            fallbackValue?: string;
            fieldName: string;
            /** @enum {string} */
            fieldType: "MONEY" | "DATETIME" | "TEXT" | "NUMBER" | "DIRECTION";
            isRequired?: boolean;
            normalizer?: string;
            priority?: number;
            regexGroupIndex?: number;
            regexPattern: string;
        };
        ReclassifyTransactionDto: Record<string, never>;
        RegisterDto: {
            baseCurrency?: string;
            /** Format: email */
            email: string;
            fullName?: string;
            locale?: string;
            password: string;
            timezone?: string;
        };
        UpdateAlertSettingDto: {
            emailEnabled?: boolean;
            inAppEnabled?: boolean;
            metadata?: Record<string, never>;
            /**
             * @description The LARGE_TRANSACTION amount in the base currency; greater than 0. null
             *     clears it (the VND default of 5,000,000 applies again).
             */
            threshold?: number | null;
            /** @enum {string} */
            type: "SYSTEM" | "BUDGET_THRESHOLD" | "LARGE_TRANSACTION" | "CATEGORY_SHIFT" | "GOAL_RISK" | "CASHFLOW_RISK" | "PARSER_ISSUE";
        };
        UpdateBudgetDto: {
            amount?: number;
            categoryId?: string;
            currency?: string;
            endsAt?: string;
            isActive?: boolean;
            metadata?: Record<string, never>;
            name?: string;
            /** @enum {string} */
            period?: "WEEKLY" | "MONTHLY" | "YEARLY" | "CUSTOM";
            rollover?: boolean;
            startsAt?: string;
            /**
             * @description The warning threshold, 1–99 (BUDGET-001); critical is fixed at 100 and
             *     not writable. Stored legacy values of 100 or more are kept but can no
             *     longer be written.
             */
            thresholdPercent?: number;
        };
        UpdateClassificationRuleDto: {
            bankName?: string | null;
            categoryId?: string;
            descriptionPattern?: string | null;
            /** @enum {string|null} */
            direction?: "INCOME" | "EXPENSE" | "TRANSFER_IN" | "TRANSFER_OUT" | "ADJUSTMENT" | null;
            isActive?: boolean;
            merchantPattern?: string | null;
            priority?: number;
        };
        UpdateEmailListenRuleDto: {
            bankProviderId?: string;
            bodyContains?: string;
            emailConnectionId?: string;
            isEnabled?: boolean;
            name?: string;
            priority?: number;
            senderDomain?: string;
            senderEmail?: string;
            subjectContains?: string;
            syncFromDate?: string;
        };
        UpdateFinancialAccountDto: {
            accountMask?: string;
            bankProviderId?: string;
            creditLimit?: number;
            currency?: string;
            currentBalance?: number;
            institutionName?: string;
            isDefault?: boolean;
            metadata?: Record<string, never>;
            name?: string;
            openingBalance?: number;
            /** @enum {string} */
            status?: "ACTIVE" | "INACTIVE" | "ARCHIVED" | "CLOSED";
            /** @enum {string} */
            type?: "BANK_ACCOUNT" | "CHECKING" | "SAVINGS" | "CREDIT_CARD" | "CASH" | "E_WALLET" | "INVESTMENT" | "OTHER";
        };
        UpdateGoalDto: {
            currency?: string;
            metadata?: Record<string, never>;
            months?: number;
            name?: string;
            /** @enum {string} */
            priority?: "CRITICAL" | "LOW" | "MEDIUM" | "HIGH";
            savedAmount?: number;
            /** @enum {string} */
            status?: "ACTIVE" | "ARCHIVED" | "PAUSED" | "COMPLETED";
            targetAmount?: number;
            targetDate?: string | null;
            type?: string;
        };
        UpdateMyProfileDto: {
            baseCurrency?: string;
            fullName?: string;
            locale?: string;
            timezone?: string;
        };
        UpdateParserTemplateDto: {
            bankProviderId?: string;
            bodyPattern?: string;
            /** @enum {string} */
            channel?: "EMAIL" | "CSV" | "SMS" | "API";
            /** @enum {string} */
            directionHint?: "INCOME" | "EXPENSE" | "TRANSFER_IN" | "TRANSFER_OUT" | "ADJUSTMENT";
            fields?: components["schemas"]["ParserFieldDto"][];
            isActive?: boolean;
            language?: string;
            name?: string;
            priority?: number;
            subjectPattern?: string;
            version?: number;
        };
        UpdateTransactionCategoryDto: {
            categoryId: string | null;
        };
        UpdateTransactionDto: {
            amount?: number;
            categoryId?: string;
            counterpartyName?: string;
            currency?: string;
            description?: string;
            /** @enum {string} */
            direction?: "INCOME" | "EXPENSE" | "TRANSFER_IN" | "TRANSFER_OUT" | "ADJUSTMENT";
            duplicateOfTransactionId?: string;
            feeAmount?: number;
            financialAccountId?: string;
            /** @description Must agree with duplicateOfTransactionId; see TransactionsService. */
            isDuplicate?: boolean;
            merchantName?: string;
            metadata?: Record<string, never>;
            postedDate?: string;
            /** @enum {string} */
            status?: "PENDING" | "POSTED" | "IGNORED" | "NEEDS_REVIEW";
            transactionTime?: string;
            userNote?: string;
        };
        UpdateUserDto: {
            baseCurrency?: string;
            fullName?: string;
            locale?: string;
            metadata?: Record<string, never>;
            /** @enum {string} */
            role?: "USER" | "ADMIN";
            /** @enum {string} */
            status?: "ACTIVE" | "DISABLED" | "PENDING_DELETE";
            timezone?: string;
        };
        UpdateUserSettingsDto: {
            allowAiInsights?: boolean;
            autoClassificationEnabled?: boolean;
            dataRetentionDays?: number;
            defaultMonthStartDay?: number;
            metadata?: Record<string, never>;
            notificationEnabled?: boolean;
            /**
             * @description DATA-001: only `false` is accepted; `true` is refused by the service
             *     with 400 RAW_EMAIL_BODY_UNAVAILABLE. Raw bodies are never retained.
             */
            storeRawEmailBody?: boolean;
        };
        UserResponseDto: {
            baseCurrency: string;
            /** Format: date-time */
            createdAt: string;
            email: string;
            fullName: string | null;
            id: string;
            /** Format: date-time */
            lastLoginAt: string | null;
            locale: string;
            role: string;
            settings: components["schemas"]["UserSettingsResponseDto"] | null;
            status: string;
            timezone: string;
            /** Format: date-time */
            updatedAt: string;
        };
        UserSettingsResponseDto: {
            allowAiInsights: boolean;
            autoClassificationEnabled: boolean;
            dataRetentionDays: number | null;
            defaultMonthStartDay: number;
            metadata: {
                [key: string]: unknown;
            } | null;
            notificationEnabled: boolean;
            /** @description Always false: raw email bodies are never retained (DATA-001). */
            rawEmailBodyAvailable: boolean;
            storeRawEmailBody: boolean;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    AlertsController_list: {
        parameters: {
            query?: {
                /** @description Read-state filter; the contract name. */
                isRead?: boolean;
                limit?: number;
                page?: number;
                /** @description Read-state filter; the existing name, kept for current clients. */
                read?: boolean;
                severity?: "INFO" | "WARNING" | "CRITICAL";
                /** @description Lifecycle status filter (ALERT-004). */
                status?: "ACTIVE" | "DISMISSED" | "RESOLVED";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Owner alerts, paginated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope"] & {
                        data?: {
                            data: components["schemas"]["Alert"][];
                            limit: number;
                            page: number;
                            total: number;
                        };
                    };
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AlertsController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateAlertDto"];
            };
        };
        responses: {
            /** @description User-authored alert */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope"] & {
                        data?: components["schemas"]["Alert"];
                    };
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AlertsController_dismiss: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Owned alert dismissed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope"] & {
                        data?: components["schemas"]["Alert"];
                    };
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AlertsController_markRead: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Owned alert marked read */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope"] & {
                        data?: components["schemas"]["Alert"];
                    };
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AlertsController_markAllRead: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AlertsController_settings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Per-type alert settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope"] & {
                        data?: components["schemas"]["AlertSetting"][];
                    };
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AlertsController_updateSetting: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateAlertSettingDto"];
            };
        };
        responses: {
            /** @description Updated alert setting */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope"] & {
                        data?: components["schemas"]["AlertSetting"];
                    };
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AlertsController_unreadCount: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AnalyticsController_cashflow: {
        parameters: {
            query?: {
                from?: string;
                to?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AnalyticsController_categoryBreakdown: {
        parameters: {
            query?: {
                /** @description User month (DASH-002); defaults to the month containing now. */
                month?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AnalyticsController_monthlySummary: {
        parameters: {
            query?: {
                /** @description User month (DASH-002); defaults to the month containing now. */
                month?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AuthController_login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthResponseDto"];
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AuthController_logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AuthController_logoutAll: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AuthController_me: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserResponseDto"];
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AuthController_refresh: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthResponseDto"];
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AuthController_register: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegisterDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserResponseDto"];
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    BankProvidersController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    BudgetsController_list: {
        parameters: {
            query?: {
                activeOnly?: boolean;
                month?: string;
                period?: "WEEKLY" | "MONTHLY" | "YEARLY" | "CUSTOM";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    BudgetsController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateBudgetDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    BudgetsController_findById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    BudgetsController_archive: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    BudgetsController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateBudgetDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    BudgetsController_recalculate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    BudgetsController_alerts: {
        parameters: {
            query?: {
                month?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    BudgetsController_summary: {
        parameters: {
            query?: {
                month?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    ClassificationRulesController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    ClassificationRulesController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateClassificationRuleDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    ClassificationRulesController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    ClassificationRulesController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateClassificationRuleDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    DashboardController_cashflow: {
        parameters: {
            query?: {
                /** @description Last month of the trend; defaults to the month containing now. */
                month?: string;
                months?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    DashboardController_categoryBreakdown: {
        parameters: {
            query?: {
                /** @description User month (DASH-002); defaults to the month containing now. */
                month?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    DashboardController_hotBudgets: {
        parameters: {
            query?: {
                /** @description User month (DASH-002); defaults to the month containing now. */
                month?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    DashboardController_insights: {
        parameters: {
            query?: {
                /** @description User month (DASH-002); defaults to the month containing now. */
                month?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    DashboardController_overview: {
        parameters: {
            query?: {
                /** @description User month (DASH-002); defaults to the month containing now. */
                month?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    DashboardController_recentTransactions: {
        parameters: {
            query?: {
                /** @description User month (DASH-002); defaults to the month containing now. */
                month?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    EmailConnectionsController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Owner connections (disconnected ones excluded) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope"] & {
                        data?: components["schemas"]["EmailConnection"][];
                    };
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    EmailConnectionsController_disconnect: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    EmailIngestionController_sync: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Terminal or continuable run result */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope"] & {
                        data?: components["schemas"]["EmailSyncRun"];
                    };
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    EmailIngestionController_listRuns: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Owner-visible sync runs, newest first */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope"] & {
                        data?: components["schemas"]["EmailSyncRun"][];
                    };
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    EmailConnectionsController_callback: {
        parameters: {
            query: {
                code: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    EmailConnectionsController_connectGmail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    EmailListenRulesController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    EmailListenRulesController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateEmailListenRuleDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    EmailListenRulesController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    EmailListenRulesController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateEmailListenRuleDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    EmailIngestionController_listMessages: {
        parameters: {
            query?: {
                emailConnectionId?: string;
                limit?: number;
                page?: number;
                processingStatus?: "PENDING" | "FAILED" | "IGNORED" | "PARSED";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    ParserController_parse: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    ParserController_listRuns: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    FinancialAccountsController_list: {
        parameters: {
            query?: {
                status?: "ACTIVE" | "INACTIVE" | "ARCHIVED" | "CLOSED";
                type?: "BANK_ACCOUNT" | "CHECKING" | "SAVINGS" | "CREDIT_CARD" | "CASH" | "E_WALLET" | "INVESTMENT" | "OTHER";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    FinancialAccountsController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateFinancialAccountDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    FinancialAccountsController_findById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    FinancialAccountsController_archive: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    FinancialAccountsController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateFinancialAccountDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    GoalsController_list: {
        parameters: {
            query?: {
                status?: "ACTIVE" | "ARCHIVED" | "PAUSED" | "COMPLETED";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Owner goals */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope"] & {
                        data?: components["schemas"]["Goal"][];
                    };
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    GoalsController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateGoalDto"];
            };
        };
        responses: {
            /** @description Created goal */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope"] & {
                        data?: components["schemas"]["Goal"];
                    };
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    GoalsController_findById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Owned goal */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope"] & {
                        data?: components["schemas"]["Goal"];
                    };
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    GoalsController_archive: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    GoalsController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateGoalDto"];
            };
        };
        responses: {
            /** @description Updated goal */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope"] & {
                        data?: components["schemas"]["Goal"];
                    };
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    GoalsController_contribute: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GoalContributionDto"];
            };
        };
        responses: {
            /** @description Goal after the contribution */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope"] & {
                        data?: components["schemas"]["Goal"];
                    };
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    GoalsController_simulate: {
        parameters: {
            query?: {
                /** @description A what-if horizon of N user months from the current one (`QUERY`). */
                months?: number;
                /**
                 * @description Retained for compatibility. INSTALLMENT applies no inferred rate or term
                 *     (GOAL-007): the result equals FULL and its reason says so.
                 */
                scenario?: "FULL" | "INSTALLMENT";
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Feasibility or insufficient-data result */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope"] & {
                        data?: components["schemas"]["GoalFeasibility"];
                    };
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    HealthController_live: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    HealthController_ready: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    ParserController_listTemplates: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    ParserController_createTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateParserTemplateDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    ParserController_updateTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateParserTemplateDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    TransactionCategoriesController_list: {
        parameters: {
            query?: {
                status?: "ACTIVE" | "ARCHIVED";
                type?: "INCOME" | "EXPENSE" | "TRANSFER" | "NEUTRAL";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    TransactionCategoriesController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateTransactionCategoryDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    TransactionCategoriesController_findById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    TransactionCategoriesController_archive: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    TransactionCategoriesController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateTransactionCategoryDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    TransactionsController_list: {
        parameters: {
            query?: {
                categoryId?: string;
                direction?: "INCOME" | "EXPENSE" | "TRANSFER_IN" | "TRANSFER_OUT" | "ADJUSTMENT";
                financialAccountId?: string;
                /** @description Inclusive lower bound; must not be after `to`. */
                from?: string;
                limit?: number;
                /** @description User month (DASH-002); cannot be combined with from/to. */
                month?: string;
                page?: number;
                search?: string;
                sourceType?: "EMAIL" | "MANUAL" | "CSV" | "SMS" | "API";
                status?: "PENDING" | "POSTED" | "IGNORED" | "DELETED" | "NEEDS_REVIEW";
                /** @description Inclusive upper bound. */
                to?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    TransactionsController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateTransactionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    TransactionsController_findById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    TransactionsController_delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    TransactionsController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateTransactionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    TransactionsController_updateCategory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateTransactionCategoryDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    TransactionsController_categoryHistory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    TransactionsController_markDuplicate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MarkDuplicateDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    TransactionsController_ignore: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    TransactionsController_reclassify: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReclassifyTransactionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    UsersController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateUserDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUserResponseDto"];
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    UsersController_findById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUserResponseDto"];
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    UsersController_deleteById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    UsersController_updateById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateUserDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUserResponseDto"];
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    UsersController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ListQueryDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    UsersController_findMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserResponseDto"];
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    UsersController_updateMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateMyProfileDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserResponseDto"];
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    UsersController_updateMySettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateUserSettingsDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserResponseDto"];
                };
            };
            /** @description Error (code, message, correlationId, and fields on validation errors) */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
}
