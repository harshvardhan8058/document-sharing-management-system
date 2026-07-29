import { Navigate, Route, Routes } from "./lib/router";
import { useAuth } from "./context/AuthContext";
import { WorkspaceProvider } from "./context/WorkspaceContext";

import Backdrop from "./components/Backdrop";
import AppShell from "./components/AppShell";
import { Spinner } from "./components/ui";
import { BrandMark } from "./lib/icons";

import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import DocumentsPage from "./pages/DocumentsPage";
import Activity from "./pages/Activity";
import Settings from "./pages/Settings";
import Admin from "./pages/Admin";
import SharedLink from "./pages/SharedLink";
import NotFound from "./pages/NotFound";

/** Shown while the stored token is exchanged for the live user record. */
function BootScreen() {
  return (
    <div className="share-page">
      <div className="col gap-5" style={{ alignItems: "center" }}>
        <span className="brand__mark" style={{ width: 54, height: 54 }}>
          <BrandMark size={28} />
        </span>
        <Spinner large />
        <p className="text-sm dim">Restoring your session…</p>
      </div>
    </div>
  );
}

/** Everything behind authentication, wrapped in the shell. */
function AuthenticatedApp() {
  const { isAdmin } = useAuth();

  return (
    <WorkspaceProvider>
      <AppShell>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/documents" element={<DocumentsPage scope="all" />} />
          <Route path="/shared" element={<DocumentsPage scope="shared" />} />
          <Route path="/starred" element={<DocumentsPage scope="starred" />} />
          <Route path="/trash" element={<DocumentsPage scope="trash" />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/admin" element={isAdmin ? <Admin /> : <NotFound />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppShell>
    </WorkspaceProvider>
  );
}

export default function App() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <>
      <Backdrop />
      <Routes>
        {/* Public: usable without an account, so it sits above the auth gate. */}
        <Route path="/s/:token" element={<SharedLink />} />

        <Route
          path="/login"
          element={isLoading ? <BootScreen /> : isAuthenticated ? <Navigate to="/" /> : <Login />}
        />
        <Route
          path="/register"
          element={isLoading ? <BootScreen /> : isAuthenticated ? <Navigate to="/" /> : <Register />}
        />

        <Route
          path="*"
          element={
            isLoading ? <BootScreen /> : isAuthenticated ? <AuthenticatedApp /> : <Navigate to="/login" />
          }
        />
      </Routes>
    </>
  );
}
