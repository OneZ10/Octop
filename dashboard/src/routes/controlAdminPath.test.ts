import { describe, expect, it } from "vitest";
import {
  ADVANCED_TAB_PERMISSIONS,
  canAccessPath,
  NAV_PERMISSIONS,
  pathPermissionKeys,
  PERM,
} from "../utils/permissions";
import { isWorkbenchPath, resolveSelectedKey, routeConfigs } from "./index";

describe("pathPermissionKeys", () => {
  it("matches workbench and legacy aliases", () => {
    expect(isWorkbenchPath("/workbench")).toBe(true);
    expect(pathPermissionKeys("/workbench")).toEqual([...PERM.workbench]);
    expect(pathPermissionKeys("/workbench/terminal")).toEqual([
      ...PERM.terminal,
    ]);
    expect(pathPermissionKeys("/workbench/browser")).toEqual([...PERM.browser]);
    expect(pathPermissionKeys("/workbench/cloud")).toEqual([...PERM.cloud]);
    expect(pathPermissionKeys("/terminal")).toEqual([...PERM.terminal]);
    expect(pathPermissionKeys("/remote-browser")).toEqual([...PERM.browser]);
  });

  it("matches remote desktop hub tabs and acp", () => {
    expect(pathPermissionKeys("/remote-desktop")).toEqual([
      "desktop",
      "mobile",
    ]);
    expect(pathPermissionKeys("/remote-desktop/desktop")).toEqual([
      ...PERM.desktop,
    ]);
    expect(pathPermissionKeys("/remote-desktop/phone")).toEqual([
      ...PERM.mobile,
    ]);
    expect(pathPermissionKeys("/remote-phone")).toEqual([...PERM.mobile]);
    expect(pathPermissionKeys("/acp")).toBe("admin");
  });

  it("keeps sso on users page, not advanced", () => {
    expect(pathPermissionKeys("/admin/users")).toEqual([...PERM.usersPage]);
    expect(pathPermissionKeys("/admin/advanced")).toEqual([
      ...PERM.advancedPage,
    ]);
    expect([...PERM.advancedPage]).not.toContain("sso");
    expect(NAV_PERMISSIONS["admin-users"]).toEqual(PERM.usersPage);
    expect(NAV_PERMISSIONS["admin-advanced"]).toEqual(PERM.advancedPage);
    expect(ADVANCED_TAB_PERMISSIONS.captcha).toBe("captcha");
    expect("bridge" in ADVANCED_TAB_PERMISSIONS).toBe(false);
    expect(pathPermissionKeys("/bridge")).toEqual([...PERM.bridge]);
    expect(NAV_PERMISSIONS.bridge).toEqual(PERM.bridge);
    expect([...PERM.advancedPage]).toContain("captcha");
  });

  it("keeps voice and search on models page, not advanced", () => {
    expect(pathPermissionKeys("/admin/models")).toEqual([...PERM.modelsPage]);
    expect(pathPermissionKeys("/admin/voice")).toEqual([...PERM.modelsPage]);
    expect([...PERM.modelsPage]).toContain("voice");
    expect([...PERM.modelsPage]).toContain("search");
    expect([...PERM.advancedPage]).not.toContain("voice");
    expect([...PERM.advancedPage]).not.toContain("search");
    expect(NAV_PERMISSIONS.models).toEqual(PERM.modelsPage);
  });

  it("does not gate common pages", () => {
    expect(pathPermissionKeys("/chat")).toBeNull();
    expect(pathPermissionKeys("/personalization/acp")).toBeNull();
  });

  it("gates cloud collab behind the bridge permission", () => {
    expect(pathPermissionKeys("/bridge")).toEqual(["bridge"]);
    expect(pathPermissionKeys("/bridge/settings")).toEqual(["bridge"]);
  });

  it("gates ungrouped pages except chat", () => {
    expect(pathPermissionKeys("/experts")).toEqual([...PERM.experts]);
    expect(pathPermissionKeys("/tasks")).toEqual([...PERM.tasks]);
    expect(pathPermissionKeys("/token-usage")).toEqual([...PERM.tokenUsage]);
    const user = { role: "user", permissions: ["experts"] };
    expect(canAccessPath(user, "/experts")).toBe(true);
    expect(canAccessPath(user, "/tasks")).toBe(false);
    expect(canAccessPath(user, "/chat")).toBe(true);
  });

  it("gates settings modules", () => {
    expect(pathPermissionKeys("/connectors")).toEqual([...PERM.connectors]);
    expect(pathPermissionKeys("/skill-packages")).toEqual([
      ...PERM.skillPackages,
    ]);
    expect(pathPermissionKeys("/personalization/skills")).toEqual([
      "skills",
      "skill_builtin",
      "skill_market",
    ]);
    expect(pathPermissionKeys("/personalization/channels")).toEqual([
      ...PERM.channels,
    ]);
    expect(pathPermissionKeys("/personalization/tools")).toEqual([
      ...PERM.tools,
    ]);
    expect(pathPermissionKeys("/personalization/plugins")).toEqual([
      ...PERM.agentPlugins,
    ]);
    expect(pathPermissionKeys("/personalization/memory")).toEqual([
      ...PERM.memory,
    ]);
    expect(pathPermissionKeys("/memory")).toEqual([...PERM.memory]);
    expect(NAV_PERMISSIONS.personalization).toEqual(PERM.personalization);
    expect(pathPermissionKeys("/knowledge-bases")).toEqual([
      ...PERM.knowledgeBasesPage,
    ]);
    expect([...PERM.advancedPage]).not.toContain("knowledge_settings");
  });

  it("keeps terminal access under Memory permissions and Personalization", () => {
    for (const path of ["/personalization/memory/mcp", "/tokens"]) {
      expect(pathPermissionKeys(path)).toEqual([...PERM.memory]);
      expect(resolveSelectedKey(path)).toBe("personalization");
    }
  });

  it("canAccessPath respects holder permissions", () => {
    const user = { role: "user", permissions: ["desktop"] };
    expect(canAccessPath(user, "/remote-desktop")).toBe(true);
    expect(canAccessPath(user, "/remote-desktop/desktop")).toBe(true);
    expect(canAccessPath(user, "/remote-desktop/phone")).toBe(false);
    expect(
      canAccessPath(
        { role: "user", permissions: ["mobile"] },
        "/remote-desktop/phone",
      ),
    ).toBe(true);
    expect(canAccessPath(user, "/admin/users")).toBe(false);
    expect(canAccessPath({ role: "admin", permissions: [] }, "/acp")).toBe(
      true,
    );
    expect(
      canAccessPath(
        { role: "user", permissions: ["knowledge_bases"] },
        "/knowledge-bases",
      ),
    ).toBe(true);
    expect(
      canAccessPath(
        { role: "user", permissions: ["knowledge_settings"] },
        "/knowledge-bases",
      ),
    ).toBe(true);
    expect(
      canAccessPath(
        { role: "user", permissions: ["knowledge_bases"] },
        "/admin/advanced",
      ),
    ).toBe(false);
  });
});

describe("unknown dashboard paths", () => {
  it("do not highlight a sidebar item", () => {
    expect(resolveSelectedKey("/does-not-exist")).toBe("");
  });

  it("are caught by the not-found route", () => {
    expect(routeConfigs.some((rc) => rc.path === "*")).toBe(true);
  });
});

describe("scoped chat history menu selection", () => {
  it("keeps write/check menus selected on their bare scoped surface", () => {
    expect(resolveSelectedKey("/chat/write")).toBe("onemind-write");
    expect(resolveSelectedKey("/chat/check")).toBe("onemind-review");
  });

  it("keeps the write/check menu on their threads when not entered from history", () => {
    // Opening a conversation from the 智能编写 / 智能审核 menu must stay on
    // that menu; only rail-initiated navigation carries the history flag.
    expect(resolveSelectedKey("/chat/write/thr-1")).toBe("onemind-write");
    expect(resolveSelectedKey("/chat/check/thr-1")).toBe("onemind-review");
  });

  it("keeps the history menu for other expert threads", () => {
    expect(resolveSelectedKey("/chat/qa-chat/thr-1")).toBe("chat");
    expect(resolveSelectedKey("/chat/bi-chat/thr-1")).toBe("chat");
    expect(resolveSelectedKey("/chat/main/thr-1")).toBe("chat");
  });

  it("keeps the history menu on the scoped surface when entered from history", () => {
    // From the history rail the scoped expert's bare surface must not light
    // the 智能编写 / 智能审核 menus, otherwise the sidebar flips away from
    // 历史对话 before the thread navigation lands.
    expect(resolveSelectedKey("/chat/write", true)).toBe("chat");
    expect(resolveSelectedKey("/chat/write/thr-1", true)).toBe("chat");
    expect(resolveSelectedKey("/chat/check", true)).toBe("chat");
    expect(resolveSelectedKey("/chat/check/thr-1", true)).toBe("chat");
  });

  it("ignores the history flag on unrelated paths", () => {
    expect(resolveSelectedKey("/experts", true)).toBe("experts");
    expect(resolveSelectedKey("/onemind/write", true)).toBe("onemind-write");
    expect(resolveSelectedKey("/chat/qa-chat/thr-1", true)).toBe("chat");
  });
});
