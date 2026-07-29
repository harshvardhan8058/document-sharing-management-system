import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { matchPath, normalizeTo } from "./paths";

/**
 * A ~150 line client-side router.
 *
 * Written in-house rather than pulled from a dependency for two reasons:
 *  1. the app has nine routes with a single dynamic segment each — the full
 *     feature surface of a routing library is unused weight;
 *  2. every published React Router line currently carries an open advisory,
 *     one of which is an open redirect through `<Link>`/`navigate()`.
 *
 * `normalizeTo` below closes that class of bug directly: a destination must be
 * a single-slash-prefixed internal path, so `//evil.com`, `\\evil.com` and
 * `https://evil.com` can never become a navigation target.
 */

const RouterContext = createContext(null);
const ParamsContext = createContext({});

function readLocation() {
  const { pathname, search, hash } = window.location;
  return { pathname, search, hash };
}

// Path parsing lives in a plain module so it can be unit tested directly.
export { normalizeTo, matchPath };

export function Router({ children }) {
  const [location, setLocation] = useState(readLocation);

  useEffect(() => {
    const sync = () => setLocation(readLocation());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const navigate = useCallback((to, { replace = false, state = null } = {}) => {
    const target = normalizeTo(to);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (target === current && !replace) return;

    window.history[replace ? "replaceState" : "pushState"](state, "", target);
    setLocation(readLocation());

    // Mirror the browser's behaviour on a fresh page load.
    if (!target.includes("#")) window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

function useRouter() {
  const context = useContext(RouterContext);
  if (!context) throw new Error("Router hooks must be used inside <Router>");
  return context;
}

export const useLocation = () => useRouter().location;
export const useNavigate = () => useRouter().navigate;
export const useParams = () => useContext(ParamsContext);

/** Renders the first `<Route>` child whose `path` matches the current URL. */
export function Routes({ children }) {
  const { pathname } = useLocation();

  const definitions = useMemo(
    () =>
      (Array.isArray(children) ? children.flat(Infinity) : [children])
        .filter((child) => child && child.props && child.props.path)
        .map((child) => child.props),
    [children]
  );

  for (const definition of definitions) {
    const params = matchPath(definition.path, pathname);
    if (params) {
      return <ParamsContext.Provider value={params}>{definition.element}</ParamsContext.Provider>;
    }
  }

  return null;
}

/** Declarative route definition. Rendered by <Routes>, never on its own. */
export function Route() {
  return null;
}

/** Imperative redirect, for use inside render trees. */
export function Navigate({ to, replace = true }) {
  const navigate = useNavigate();

  useEffect(() => {
    navigate(to, { replace });
  }, [navigate, to, replace]);

  return null;
}

/**
 * Internal link. Falls back to default browser behaviour for modified clicks
 * (new tab, new window, download) so the app never hijacks user intent.
 */
export function Link({ to, children, onClick, replace, ...rest }) {
  const navigate = useNavigate();
  const href = normalizeTo(to);

  const handleClick = (event) => {
    if (onClick) onClick(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0) return; // not a primary click
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (rest.target && rest.target !== "_self") return;

    event.preventDefault();
    navigate(href, { replace });
  };

  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}

/** Link that knows whether it points at the current section. */
export function NavLink({ to, className, children, end = false, ...rest }) {
  const { pathname } = useLocation();
  const target = normalizeTo(to);

  const isActive = end
    ? pathname === target
    : pathname === target || pathname.startsWith(`${target}/`);

  return (
    <Link
      to={target}
      className={typeof className === "function" ? className(isActive) : className}
      aria-current={isActive ? "page" : undefined}
      {...rest}
    >
      {typeof children === "function" ? children(isActive) : children}
    </Link>
  );
}

/**
 * Read and write the query string.
 * @returns {[URLSearchParams, (next: object|URLSearchParams, options?: object) => void]}
 */
export function useSearchParams() {
  const { location, navigate } = useRouter();

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const setParams = useCallback(
    (next, { replace = true } = {}) => {
      const resolved =
        next instanceof URLSearchParams
          ? next
          : Object.entries(next).reduce((acc, [key, value]) => {
              if (value !== undefined && value !== null && value !== "") acc.set(key, String(value));
              return acc;
            }, new URLSearchParams());

      const query = resolved.toString();
      navigate(`${window.location.pathname}${query ? `?${query}` : ""}`, { replace });
    },
    [navigate]
  );

  return [params, setParams];
}
