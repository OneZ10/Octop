import { useEffect, useRef } from "react";
import type { ChatMode } from "../../../api/modules/onemindChat";
import { useAgent } from "../../../context/AgentContext";
import AssistantTurnView from "../../Chat/components/AssistantTurnView";
import MessageBubble from "../../Chat/components/MessageBubble";
import ChatInput, {
  type ChatInputHandle,
} from "../../Chat/components/ChatInput";
import WelcomeScreen from "../../Chat/components/WelcomeScreen";
import { useExpertChatWelcome } from "../../Chat/hooks/useExpertQuickCards";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import CitationsBlock, { type SourceDoc } from "./CitationsBlock";
import ResultBlock from "./ResultBlock";
import type { Turn } from "./types";
import styles from "./qa.module.less";

/**
 * OneMind direct-connect conversation surface. Reuses the Octop native turn
 * renderer (thinking fold + tool calls + answer bubble), the native welcome
 * screen for a fresh session, and the native composer; adds the citation strip
 * and ChatBI rich result (chart / table / SQL / follow-ups).
 */
export default function ChatPanel({
  mode,
  turns,
  streaming,
  send,
  stop,
  onOpenDoc,
  onNewChat,
}: {
  mode: ChatMode;
  turns: Turn[];
  streaming: boolean;
  send: (q: string) => void;
  stop: () => void;
  onOpenDoc: (doc: SourceDoc) => void;
  onNewChat: () => void;
}) {
  const { t } = useTranslation();
  const { agents } = useAgent();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<ChatInputHandle>(null);
  const agent =
    agents.find(
      (a) => a.agent_id === (mode === "kbflow" ? "qa-chat" : "bi-chat"),
    ) ?? null;
  const { quickCards, welcomeSuffix } = useExpertChatWelcome(agent);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  const submit = (q: string) => {
    const text = q.trim();
    if (!text || streaming) return;
    send(text);
  };

  return (
    <div className={styles.chatMain}>
      <div className={styles.messages}>
        {turns.length === 0 ? (
          <div className={styles.welcomeHost}>
            <WelcomeScreen
              onPromptClick={(text) => inputRef.current?.setPrefillText(text)}
              agentName={agent?.name ?? null}
              welcomeSuffix={welcomeSuffix}
              quickCards={quickCards}
            />
          </div>
        ) : null}
        {turns.map((turn, i) => (
          <div key={turn.id}>
            <MessageBubble message={turn.user} />
            <AssistantTurnView
              messages={turn.messages}
              isStreaming={turn.streaming}
              isTurnInProgress={turn.streaming}
              afterLatestUser={i === turns.length - 1}
            />
            {turn.extras.citations?.length ? (
              <CitationsBlock
                citations={turn.extras.citations}
                onOpenDoc={onOpenDoc}
              />
            ) : null}
            <ResultBlock
              result={turn.extras.result}
              chart={turn.extras.chart}
            />
            {turn.extras.followups?.length ? (
              <>
                <div className={styles.followupsLabel}>
                  <Sparkles size={13} />
                  {t("onemind.chat.followupsLabel")}
                </div>
                <div className={styles.followups}>
                  {turn.extras.followups.map((q) => (
                    <button
                      key={q}
                      type="button"
                      className={styles.followupChip}
                      disabled={streaming}
                      onClick={() => submit(q)}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className={styles.composer}>
        <ChatInput
          ref={inputRef}
          onSend={(text) => submit(text)}
          onCancel={stop}
          onNewChat={onNewChat}
          isStreaming={streaming}
          agentId={null}
          threadId={null}
        />
      </div>
    </div>
  );
}
