import {
  useEffect,
  useRef,
  useState,
  type SetStateAction,
  type Dispatch,
} from "react";
// Only navigation state is retained here. Sessions/credentials are never restored by Back.
type Snapshot = Record<string, unknown>;
let scope = "",
  values: Snapshot = {},
  entries = new Map<string, Snapshot>(),
  listeners = new Map<string, Set<(v: unknown) => void>>(),
  defaults: Snapshot = {},
  pending = false,
  push = false,
  restoring = false;
function address() {
  const url = new URL(window.location.href);
  const view = values["app.view"];
  url.hash =
    typeof view === "string"
      ? view +
        (view === "staff-workspace" &&
        typeof values["workspace.screen"] === "string"
          ? "/" + values["workspace.screen"]
          : "")
      : "";
  return url;
}
function write(add: boolean) {
  // Let Supabase consume sign-in/recovery fragments before changing the URL.
  if (
    /access_token=|refresh_token=|error_description=|type=recovery/.test(
      window.location.hash,
    )
  )
    return;
  const id = crypto.randomUUID();
  entries.set(id, { ...values });
  const state = {
    ...(window.history.state || {}),
    salonNavigation: { id, scope },
  };
  window.history[add ? "pushState" : "replaceState"](state, "", address());
}
function schedule(add: boolean) {
  push ||= add;
  if (pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    if (restoring) {
      push = false;
      return;
    }
    write(push);
    push = false;
  });
}
export function resetNavigationScope(next: string) {
  if (scope === next) return;
  const recovery = values["app.view"] === "recovery";
  scope = next;
  entries.clear();
  values = { ...defaults };
  if (recovery) values["app.view"] = "recovery";
  for (const [key, subs] of listeners)
    if (key in values) for (const fn of subs) fn(values[key]);
  push = false;
  write(false);
}
export function clearWorkspaceNavigation() {
  for (const key of Object.keys(values))
    if (key.startsWith("workspace.")) delete values[key];
}
function pop() {
  if (!listeners.get("app.view")?.size) return;
  const nav = window.history.state?.salonNavigation;
  const snapshot = nav?.scope === scope ? entries.get(nav.id) : undefined;
  // Old sessions and other portals are not navigation snapshots for the current login.
  if (!snapshot) {
    write(false);
    return;
  }
  restoring = true;
  values = { ...snapshot };
  for (const [key, subs] of listeners)
    if (key in values) for (const fn of subs) fn(values[key]);
  queueMicrotask(() => {
    restoring = false;
  });
}
let installed = false;
export function useNavigationState<T>(
  key: string,
  initial: T,
  pushChanges = true,
): [T, Dispatch<SetStateAction<T>>] {
  if (!installed && typeof window !== "undefined") {
    window.addEventListener("popstate", pop);
    installed = true;
  }
  const [state, setState] = useState<T>(() => {
    if (key === "app.view" && !listeners.get(key)?.size) {
      values = {};
      entries.clear();
    }
    return key in values ? (values[key] as T) : initial;
  });
  const previous = useRef(state);
  useEffect(() => {
    defaults[key] = initial;
    const callback = (v: unknown) => {
      previous.current = v as T;
      setState(v as T);
    };
    const subs = listeners.get(key) || new Set();
    subs.add(callback);
    listeners.set(key, subs);
    values[key] = state;
    return () => {
      subs.delete(callback);
    };
  }, [key]);
  useEffect(() => {
    values[key] = state;
    if (!Object.is(previous.current, state)) {
      previous.current = state;
      schedule(pushChanges);
    }
  }, [state, key, pushChanges]);
  return [state, setState];
}
