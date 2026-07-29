function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  aws: {
    region: process.env.AWS_REGION ?? "ap-northeast-1",
    dynamoTableName: process.env.DYNAMODB_TABLE_NAME ?? "RakutenRankings",
    // dynamodb-local 等でローカル開発する場合のみ設定 (例: http://localhost:8000)
    dynamoEndpoint: process.env.DYNAMODB_ENDPOINT,
  },
  rakuten: {
    get applicationId(): string {
      return required("RAKUTEN_APP_ID");
    },
    // 2026年のインフラ移行 (openapi.rakuten.co.jp) 後は applicationId に加えて必須
    get accessKey(): string {
      return required("RAKUTEN_ACCESS_KEY");
    },
  },
  gemini: {
    get apiKey(): string {
      return required("GEMINI_API_KEY");
    },
  },
  cron: {
    secret: process.env.CRON_SECRET,
  },
} as const;
