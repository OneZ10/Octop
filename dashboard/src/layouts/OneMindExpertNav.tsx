import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Dropdown } from "antd";
import type { MenuProps } from "antd";
import {
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import cx from "classnames";
import { useAgent } from "../context/AgentContext";
import type { OctopAgent } from "../context/AgentContext";
import { ExpertIcon } from "../pages/Experts/components/iconForName";
import ExpertNameLabel from "../pages/Chat/components/ExpertNameLabel";
import ExpertNavActions, {
  ExpertPinMark,
} from "../pages/Chat/components/ExpertNavActions";
import { usePinnedExperts } from "../pages/Chat/hooks/usePinnedExperts";
import { sortExpertsByPin } from "../pages/Chat/utils/pinnedExpertsPrefs";
import {
  onemindThreadsApi,
  type OnemindThreadMeta,
} from "../api/modules/onemindThreads";
import type { ChatMode } from "../api/modules/onemindChat";
import { isImeComposing } from "../utils/ime";
import styles from "../pages/Chat/index.module.less";

const MODE_BY_AGENT: Record<string, ChatMode> = {
  "qa-chat": "kbflow",
  "bi-chat": "chatbi",
};
const COLLAPSE_KEY = "octop:onemind-expert-folders-collapsed";

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

interface RowProps {
  thread: OnemindThreadMeta;
  active: boolean;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
}

function SessionRow({
  thread,
  active,
  onOpen,
  onRename,
  onPin,
  onDelete,
}: RowProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(thread.title);
  useEffect(() => {
    if (!editing) setValue(thread.title);
  }, [thread.title, editing]);
  const commit = () => {
    const next = value.trim();
    if (next && next !== thread.title) onRename(thread.id, next);
    setEditing(false);
  };
  const items: MenuProps["items"] = [
    {
      key: "pin",
      icon: thread.pinned ? <PinOff size={14} /> : <Pin size={14} />,
      label: thread.pinned
        ? t("chat.unpin", "取消置顶")
        : t("chat.pin", "置顶"),
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        onPin(thread.id, !thread.pinned);
      },
    },
    {
      key: "rename",
      icon: <Pencil size={14} />,
      label: t("common.rename", "重命名"),
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        setEditing(true);
      },
    },
    {
      key: "delete",
      icon: <Trash2 size={14} />,
      label: t("common.delete", "删除"),
      danger: true,
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        onDelete(thread.id);
      },
    },
  ];
  return (
    <div
      className={cx(
        styles.sessionRow,
        styles.sessionRowCompact,
        active && styles.sessionRowActive,
        thread.pinned && styles.sessionRowPinned,
      )}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (!editing) onOpen(thread.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !editing) onOpen(thread.id);
      }}
    >
      {editing ? (
        <input
          autoFocus
          className={styles.sessionNameInput}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <>
          <span className={styles.sessionRowTitleGroup}>
            <span className={styles.sessionRowTitle}>{thread.title}</span>
          </span>
          {thread.pinned ? (
            <span
              className={styles.sessionRowPinIndicator}
              title={t("chat.unpin", "取消置顶")}
            >
              <Pin size={12} strokeWidth={2} />
            </span>
          ) : null}
          <Dropdown
            menu={{ items }}
            trigger={["click"]}
            placement="bottomRight"
          >
            <button
              type="button"
              className={styles.sessionRowMore}
              aria-label={t("common.more", "更多")}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal size={15} />
            </button>
          </Dropdown>
        </>
      )}
    </div>
  );
}

export default function OneMindExpertNav({
  singleMode = null,
  fixedOrder = false,
}: {
  singleMode?: ChatMode | null;
  fixedOrder?: boolean;
} = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { agents } = useAgent();
  const { pinnedIds, isPinned, togglePin } = usePinnedExperts();
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    loadCollapsed(),
  );
  const [byMode, setByMode] = useState<Record<string, OnemindThreadMeta[]>>({});
  const activeMode = params.get("mode") === "chatbi" ? "chatbi" : "kbflow";
  const activeThread = params.get("thread");

  const experts = useMemo(() => {
    let list = agents.filter((a) => MODE_BY_AGENT[a.agent_id]);
    if (singleMode) {
      list = list.filter((a) => MODE_BY_AGENT[a.agent_id] === singleMode);
    }
    if (singleMode || fixedOrder) {
      const order = ["qa-chat", "bi-chat"];
      return [...list].sort(
        (a, b) => order.indexOf(a.agent_id) - order.indexOf(b.agent_id),
      );
    }
    return sortExpertsByPin(list, pinnedIds);
  }, [agents, pinnedIds, singleMode, fixedOrder]);

  const refresh = useCallback(async () => {
    const [kb, cb] = await Promise.all([
      onemindThreadsApi.list("kbflow").catch(() => ({ threads: [] })),
      onemindThreadsApi.list("chatbi").catch(() => ({ threads: [] })),
    ]);
    setByMode({ kbflow: kb.threads, chatbi: cb.threads });
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleFolder = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const openMode = (mode: ChatMode) => navigate(`/onemind/qa?mode=${mode}`);
  const openThread = (mode: ChatMode, id: string) =>
    navigate(`/onemind/qa?mode=${mode}&thread=${id}`);
  const newChat = (mode: ChatMode) =>
    navigate(`/onemind/qa?mode=${mode}&new=1`);

  const rename = async (id: string, name: string) => {
    await onemindThreadsApi.patch(id, { title: name }).catch(() => {});
    void refresh();
  };
  const pin = async (id: string, pinned: boolean) => {
    await onemindThreadsApi.patch(id, { pinned }).catch(() => {});
    void refresh();
  };
  const del = async (id: string) => {
    await onemindThreadsApi.remove(id).catch(() => {});
    if (activeThread === id) openMode(activeMode);
    void refresh();
  };

  return (
    <div className={cx(styles.sessionList, styles.minimalAgentNav)}>
      {experts.map((agent: OctopAgent) => {
        const mode = MODE_BY_AGENT[agent.agent_id];
        const list = byMode[mode] ?? [];
        const expanded = !collapsed.has(agent.agent_id);
        const isActiveExpert = mode === activeMode;
        return (
          <section key={agent.agent_id} className={styles.minimalAgentSection}>
            <div className={styles.minimalAgentHeader}>
              <span className={styles.minimalAgentIconSlot}>
                <span className={styles.minimalAgentAvatarHost}>
                  <span
                    className={styles.minimalAgentAvatar}
                    style={{
                      color: agent.color || "var(--fn-text-tertiary)",
                      background: `${agent.color || "#6366f1"}14`,
                    }}
                    aria-hidden
                  >
                    <ExpertIcon
                      iconUrl={agent.icon_url}
                      iconName={agent.icon_name}
                      size={agent.icon_url?.trim() ? 22 : 14}
                    />
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.minimalAgentChevronBtn}
                  aria-expanded={expanded}
                  onClick={() => toggleFolder(agent.agent_id)}
                >
                  <ChevronRight
                    size={14}
                    strokeWidth={2}
                    className={cx(
                      styles.minimalAgentChevron,
                      expanded && styles.minimalAgentChevronOpen,
                    )}
                    aria-hidden
                  />
                </button>
              </span>
              <button
                type="button"
                className={styles.minimalAgentFolderBtn}
                onClick={() => openMode(mode)}
              >
                <span className={styles.agentNameCluster}>
                  <ExpertNameLabel
                    name={agent.name}
                    className={styles.minimalAgentName}
                  />
                  <ExpertPinMark pinned={isPinned(agent.agent_id)} />
                </span>
              </button>
              <ExpertNavActions
                variant="minimal"
                pinned={isPinned(agent.agent_id)}
                onTogglePin={() => togglePin(agent.agent_id)}
                onNewChat={() => newChat(mode)}
              />
            </div>
            {expanded ? (
              <div className={styles.minimalAgentSessions}>
                {list.length === 0 ? (
                  <div className={styles.minimalAgentEmpty}>
                    {t("chat.noSessionsYet", "直接发消息即可开始对话")}
                  </div>
                ) : (
                  list.map((thread) => (
                    <SessionRow
                      key={thread.id}
                      thread={thread}
                      active={isActiveExpert && thread.id === activeThread}
                      onOpen={(id) => openThread(mode, id)}
                      onRename={(id, name) => void rename(id, name)}
                      onPin={(id, p) => void pin(id, p)}
                      onDelete={(id) => void del(id)}
                    />
                  ))
                )}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
