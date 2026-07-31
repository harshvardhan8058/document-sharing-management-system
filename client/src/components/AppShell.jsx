import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "../lib/router";
import { BrandMark, Icon } from "../lib/icons";
import { Button, IconButton, Input, Progress } from "./ui";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { useToast } from "../context/ToastContext";
import { useTheme } from "../context/ThemeContext";
import { useDocumentDrop } from "../lib/useDocumentDrop";
import { formatNumber, modifierKeyLabel, usageTone } from "../lib/format";
import UploadDialog from "./UploadDialog";
import ShareDialog from "./ShareDialog";
import DocumentDrawer from "./DocumentDrawer";
import CommandPalette from "./CommandPalette";
import NotificationCenter from "./NotificationCenter";
import CollectionsNav from "./CollectionsNav";

const ShellContext = createContext(null);

/** Lets any page open the drawer, the share dialog or the uploader. */
export const useShell = () => {
  const context = useContext(ShellContext);
  if (!context) throw new Error("useShell must be used inside <AppShell>");
  return context;
};

const PRIMARY_NAV = [
  { to: "/", label: "Dashboard", icon: "dashboard", end: true },
  { to: "/documents", label: "All documents", icon: "files", count: "documents" },
  { to: "/shared", label: "Shared with me", icon: "share", count: "shared" },
  { to: "/starred", label: "Starred", icon: "star", count: "starred" },
];

const SECONDARY_NAV = [
  { to: "/activity", label: "Activity", icon: "activity" },
  { to: "/trash", label: "Trash", icon: "trash", count: "trashed" },
];

export default function AppShell({ children }) {
  const { user, logout, isAdmin } = useAuth();
  const { limits, overview, counts, notifyChanged, liveNotification, clearLiveNotification } = useWorkspace();
  const toast = useToast();
  const { isDark, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const searchRef = useRef(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState([]);
  const [shareTarget, setShareTarget] = useState(null);
  const [drawerId, setDrawerId] = useState(null);
  const [search, setSearch] = useState("");

  // Dropping a file anywhere in the window opens the uploader pre-filled.
  const handleDroppedFiles = useCallback((files) => {
    setDroppedFiles(files);
    setUploadOpen(true);
  }, []);
  const isDragging = useDocumentDrop(handleDroppedFiles);

  const openUpload = useCallback(() => {
    setDroppedFiles([]);
    setUploadOpen(true);
  }, []);

  const openDocument = useCallback((documentOrId) => {
    setDrawerId(typeof documentOrId === "string" ? documentOrId : documentOrId.id);
  }, []);

  const openShare = useCallback((document) => setShareTarget(document), []);

  /**
   * Close the drawer, and if the address bar is pointing at that document, put it
   * back on the library. Otherwise a closed drawer would leave a URL that
   * reopens itself on reload.
   */
  const closeDocument = useCallback(() => {
    setDrawerId(null);
    if (/^\/documents\/[^/]+$/.test(window.location.pathname)) {
      navigate("/documents", { replace: true });
    }
  }, [navigate]);

  const shell = useMemo(
    () => ({ openUpload, openDocument, openShare, closeDocument }),
    [openUpload, openDocument, openShare, closeDocument]
  );

  // Global shortcuts. Ignored while the user is typing in a field.
  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }

      if (typing) return;

      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key.toLowerCase() === "u" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        openUpload();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openUpload]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setSidebarOpen(false), [pathname]);

  /**
   * Paste a file to upload it.
   *
   * Screenshots live on the clipboard, never on disk — without this, sharing one
   * means saving it somewhere first just to pick it back up.
   */
  useEffect(() => {
    const onPaste = (event) => {
      const target = event.target;
      // Never hijack a paste the user aimed at a text field.
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }

      const files = Array.from(event.clipboardData?.files || []);
      if (!files.length) return;

      event.preventDefault();
      setDroppedFiles(files);
      setUploadOpen(true);
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  /** Surface a live notification as a toast, then clear it. */
  useEffect(() => {
    if (!liveNotification) return;
    toast.push({
      tone: "info",
      title: liveNotification.title,
      body: liveNotification.body || undefined,
    });
    clearLiveNotification();
  }, [liveNotification, clearLiveNotification, toast]);

  const submitSearch = (event) => {
    event.preventDefault();
    const term = search.trim();
    navigate(term ? `/documents?search=${encodeURIComponent(term)}` : "/documents");
  };

  const storage = overview?.storage;
  const tone = storage ? usageTone(storage.usedPercent) : "ok";

  const renderNavLink = (item) => {
    const count = item.count ? counts[item.count] : null;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        className={(active) => `nav__link ${active ? "nav__link--active" : ""}`}
      >
        <span className="nav__icon">
          <Icon name={item.icon} size={16} />
        </span>
        <span className="grow">{item.label}</span>
        {count ? <span className="nav__count">{formatNumber(count)}</span> : null}
      </NavLink>
    );
  };

  return (
    <ShellContext.Provider value={shell}>
      {/* First stop for keyboard users: skip the sidebar and topbar entirely. */}
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <div className="shell">
        {sidebarOpen ? (
          <div className="sidebar-scrim only-mobile" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
        ) : null}

        <aside className={`sidebar ${sidebarOpen ? "sidebar--open" : ""}`}>
          <div className="brand">
            <span className="brand__mark">
              <BrandMark size={21} />
            </span>
            <div>
              <div className="brand__name gradient-text">DSMS</div>
              <div className="brand__tag">Document vault</div>
            </div>
          </div>

          <Button variant="primary" icon="upload" onClick={openUpload} block>
            Upload
          </Button>

          <nav className="nav" aria-label="Main">
            {PRIMARY_NAV.map(renderNavLink)}

            <div className="nav__section">Workspace</div>
            {SECONDARY_NAV.map(renderNavLink)}

            {/* Documents can be dragged straight onto a collection. */}
            <CollectionsNav />

            {isAdmin ? (
              <>
                <div className="nav__section">Administration</div>
                {renderNavLink({ to: "/admin", label: "Instance health", icon: "shield" })}
              </>
            ) : null}
          </nav>

          <div className="sidebar__footer">
            {storage ? (
              <div className="storage-card">
                <div className="row between text-xs">
                  <span className="dim">Storage</span>
                  <span className="nums semi">{storage.usedPercent}%</span>
                </div>
                <Progress value={storage.usedPercent} tone={tone} />
                <div className="text-xs dim nums">
                  {storage.usedLabel} of {storage.quotaLabel}
                </div>
              </div>
            ) : null}

            <NavLink to="/settings" className="user-card">
              <span
                className="avatar"
                style={
                  user?.accentColor
                    ? { background: `linear-gradient(135deg, ${user.accentColor}, ${user.accentColor}88)` }
                    : undefined
                }
              >
                {user?.initials || "?"}
              </span>
              <span className="user-card__text">
                <span className="user-card__name">{user?.fullName}</span>
                <span className="user-card__mail">{user?.email}</span>
              </span>
              <Icon name="settings" size={14} className="dim" />
            </NavLink>

            <Button variant="ghost" size="sm" icon="logout" onClick={logout} block>
              Sign out
            </Button>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <IconButton
              icon="menu"
              label="Open navigation"
              className="only-mobile"
              onClick={() => setSidebarOpen(true)}
            />

            <form className="topbar__search" onSubmit={submitSearch} role="search">
              <Input
                ref={searchRef}
                icon="search"
                type="search"
                placeholder="Search documents…   /"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search documents"
              />
            </form>

            <span className="topbar__spacer" />

            <div className="topbar__actions">
              <Button
                variant="ghost"
                size="sm"
                icon="command"
                onClick={() => setPaletteOpen(true)}
                aria-label="Open the command palette"
              >
                <span className="only-desktop row gap-1">
                  <span className="kbd">{modifierKeyLabel()}</span>
                  <span className="kbd">K</span>
                </span>
              </Button>
              <NotificationCenter onOpenDocument={openDocument} />
              <IconButton
                icon={isDark ? "sun" : "moon"}
                label={isDark ? "Switch to the light theme" : "Switch to the dark theme"}
                onClick={toggleTheme}
              />
            </div>
          </header>

          <main className="content" id="main-content">
            {children}
          </main>
        </div>
      </div>

      {isDragging ? (
        <div className="drop-overlay">
          <div className="drop-overlay__inner">
            <span className="dropzone__icon">
              <Icon name="upload" size={26} />
            </span>
            <div>
              <div className="text-md bold">Drop to upload</div>
              <p className="text-sm dim mt-1">Release anywhere on the page</p>
            </div>
          </div>
        </div>
      ) : null}

      <UploadDialog
        open={uploadOpen}
        onClose={() => {
          setUploadOpen(false);
          setDroppedFiles([]);
        }}
        onUploaded={notifyChanged}
        limits={limits}
        initialFiles={droppedFiles}
      />

      {shareTarget ? (
        <ShareDialog
          open
          document={shareTarget}
          onClose={() => setShareTarget(null)}
          onChanged={notifyChanged}
        />
      ) : null}

      {drawerId ? (
        <DocumentDrawer
          documentId={drawerId}
          onClose={closeDocument}
          onChanged={notifyChanged}
          onShare={openShare}
        />
      ) : null}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onUpload={openUpload}
        onOpenDocument={openDocument}
        isAdmin={isAdmin}
      />
    </ShellContext.Provider>
  );
}
