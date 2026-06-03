import { 
    Refine,
    GitHubBanner, 
    WelcomePage,
    Authenticated
,AuthProvider, 
} from '@refinedev/core';
import { DevtoolsPanel, DevtoolsProvider } from "@refinedev/devtools";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";

import { AuthPage,ErrorComponent
,useNotificationProvider
,ThemedLayout
,ThemedSider} from '@refinedev/antd';
import "@refinedev/antd/dist/reset.css";

import { App as AntdApp } from "antd"
import { BrowserRouter, Route, Routes, Outlet } from "react-router";
import routerProvider, { NavigateToResource, CatchAllNavigate, UnsavedChangesNotifier, DocumentTitleHandler } from "@refinedev/react-router";
import axios from "axios";
import { useAuth0 } from "@auth0/auth0-react";
import { dataProvider } from "./providers/data";
import { ColorModeContextProvider } from "./contexts/color-mode";
import { Header } from "./components/header";
import { Login } from "./pages/login";





function App() {
    const { isLoading, user, logout, getIdTokenClaims } = useAuth0();

    
            if (isLoading) {
                return <span>loading...</span>
            }

            const authProvider: AuthProvider = {
                login: async () => {
                    return {
                        success: true,
                    };
                },
                logout: async () => {
                    logout({ returnTo: window.location.origin });
                    return {
                        success: true,
                    };
                },
                onError: async (error) => {
                    console.error(error);
                    return { error };
                },
                check: async () => {
                    try {
                        const token = await getIdTokenClaims();
                        if (token) {
                            axios.defaults.headers.common = {
Authorization: `Bearer ${token.__raw}`

                            };
                            return {
                                authenticated: true,
                            };
                        } else {
                            return {
                                authenticated: false,
                                error: {
                                    message: "Check failed",
                                    name: "Token not found",
                                },
                                redirectTo: "/login",
                                logout: true,
                            };
                        }
                    } catch (error: any) {
                        return {
                            authenticated: false,
                            error: new Error(error),
                            redirectTo: "/login",
                            logout: true,
                        };
                    }
                },
                getPermissions: async () => null,
                getIdentity: async () => {
                    if (user) {
                        return {
                            ...user,
                            avatar: user.picture,
                        };
                    }
                    return null;
                },
            };
            
    
    return (
        <BrowserRouter>
        <GitHubBanner />
        <RefineKbarProvider>
            <ColorModeContextProvider>
<AntdApp>
            <DevtoolsProvider>
                <Refine dataProvider={dataProvider}
notificationProvider={useNotificationProvider}
routerProvider={routerProvider}
authProvider={authProvider} 
                    options={{
                        syncWithLocation: true,
                        warnWhenUnsavedChanges: true,
                        
                    }}
                >


                        <Routes>
                            <Route index element={<WelcomePage />} />
                        </Routes>
                    <RefineKbar />
                    <UnsavedChangesNotifier />
                    <DocumentTitleHandler />
                </Refine>
            <DevtoolsPanel />
            </DevtoolsProvider>
            </AntdApp>
</ColorModeContextProvider>
        </RefineKbarProvider>
        </BrowserRouter>
      );
};

export default App;
