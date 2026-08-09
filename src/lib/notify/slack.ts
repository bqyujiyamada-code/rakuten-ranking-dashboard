import { env } from "@/lib/config/env";

const SLACK_TIMEOUT_MS = 10_000;

/**
 * Slack Incoming Webhookへテキストを送信する。SLACK_WEBHOOK_URL未設定・送信失敗時も
 * 例外を投げない(通知の失敗がCronのレスポンスや実際の収集結果に影響してはならないため)。
 */
export async function notifySlack(text: string): Promise<void> {
  const webhookUrl = env.notify.slackWebhookUrl;
  if (!webhookUrl) {
    console.warn("[notify] SLACK_WEBHOOK_URL is not set, skipping Slack notification");
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(
        `[notify] Slack webhook returned ${response.status}: ${await response.text()}`,
      );
    }
  } catch (error) {
    console.error("[notify] Failed to send Slack notification", error);
  }
}
