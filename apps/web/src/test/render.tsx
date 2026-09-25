import { Refine } from "@refinedev/core";
import { App as AntdApp, ConfigProvider } from "antd";
import viVN from "antd/locale/vi_VN";
import { act, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { authProvider } from "@/providers/authProvider";
import { dataProvider } from "@/providers/dataProvider";

/**
 * Renders a page inside the app's real auth and data providers (so every request
 * goes through `api/client.ts` to the mocked `fetch`), antd's App and locale, and a
 * router. It mirrors `AppProvider` except that React Query does not retry, so an
 * error state appears at once and each request is sent exactly as often as the
 * page asks for it.
 */
export function renderWithProviders(ui: ReactElement, { route = "/" }: { route?: string } = {}) {
  const user = userEvent.setup();
  const view = render(
    <Refine
      authProvider={authProvider}
      dataProvider={dataProvider}
      options={{
        syncWithLocation: false,
        warnWhenUnsavedChanges: false,
        disableTelemetry: true,
        reactQuery: { clientConfig: { defaultOptions: { queries: { retry: false }, mutations: { retry: false } } } },
      }}
    >
      <ConfigProvider locale={viVN}>
        <AntdApp>
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </AntdApp>
      </ConfigProvider>
    </Refine>,
  );
  return { user, ...view };
}

/**
 * Lets queued work settle: antd validates a form submit asynchronously, so a click
 * can send its request after the click resolves. Assert "no further request" after this.
 */
export const settle = (ms = 50) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
