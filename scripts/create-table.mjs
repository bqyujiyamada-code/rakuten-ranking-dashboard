// DynamoDB `RakutenRankings` テーブルを作成するワンショットスクリプト。
// 使い方: npm run db:create-table
// 既存テーブルがある場合、テーブル自体の作成はスキップしつつ、
// GSI2_DailyBundle (気象/トレンド/バックナンバー機能で追加) が無ければ UpdateTable で追加する。
import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceInUseException,
  UpdateTableCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";

const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? "RakutenRankings";
const ENDPOINT = process.env.DYNAMODB_ENDPOINT;
const GSI2_NAME = "GSI2_DailyBundle";

const client = new DynamoDBClient({
  region: REGION,
  ...(ENDPOINT ? { endpoint: ENDPOINT } : {}),
});

async function waitForGsiActive(tableName, indexName, maxWaitMs = 5 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const describe = await client.send(
      new DescribeTableCommand({ TableName: tableName }),
    );
    const gsi = (describe.Table?.GlobalSecondaryIndexes ?? []).find(
      (g) => g.IndexName === indexName,
    );
    if (gsi?.IndexStatus === "ACTIVE") return;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`Timed out waiting for GSI "${indexName}" to become ACTIVE`);
}

/** 既存テーブルに GSI2_DailyBundle が無ければ UpdateTable で追加する */
async function ensureGsi2(tableName) {
  const describe = await client.send(
    new DescribeTableCommand({ TableName: tableName }),
  );
  const existingGsiNames = (describe.Table?.GlobalSecondaryIndexes ?? []).map(
    (g) => g.IndexName,
  );
  if (existingGsiNames.includes(GSI2_NAME)) {
    console.log(`GSI "${GSI2_NAME}" already exists. Skipping.`);
    return;
  }

  console.log(`Adding GSI "${GSI2_NAME}" to existing table via UpdateTable...`);
  await client.send(
    new UpdateTableCommand({
      TableName: tableName,
      AttributeDefinitions: [
        { AttributeName: "GSI2PK", AttributeType: "S" },
        { AttributeName: "GSI2SK", AttributeType: "S" },
      ],
      GlobalSecondaryIndexUpdates: [
        {
          Create: {
            IndexName: GSI2_NAME,
            KeySchema: [
              { AttributeName: "GSI2PK", KeyType: "HASH" },
              { AttributeName: "GSI2SK", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          },
        },
      ],
    }),
  );

  console.log("Waiting for GSI to become ACTIVE (this can take a few minutes)...");
  await waitForGsiActive(tableName, GSI2_NAME);
  console.log(`GSI "${GSI2_NAME}" is ready.`);
}

async function main() {
  console.log(`Creating table "${TABLE_NAME}" in ${REGION}...`);

  try {
    await client.send(
      new CreateTableCommand({
        TableName: TABLE_NAME,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [
          { AttributeName: "PK", AttributeType: "S" },
          { AttributeName: "SK", AttributeType: "S" },
          { AttributeName: "GSI1PK", AttributeType: "S" },
          { AttributeName: "GSI1SK", AttributeType: "S" },
          { AttributeName: "GSI2PK", AttributeType: "S" },
          { AttributeName: "GSI2SK", AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "PK", KeyType: "HASH" },
          { AttributeName: "SK", KeyType: "RANGE" },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: "GSI1_GenreTimestamp",
            KeySchema: [
              { AttributeName: "GSI1PK", KeyType: "HASH" },
              { AttributeName: "GSI1SK", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          },
          {
            IndexName: GSI2_NAME,
            KeySchema: [
              { AttributeName: "GSI2PK", KeyType: "HASH" },
              { AttributeName: "GSI2SK", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          },
        ],
      }),
    );
  } catch (error) {
    if (error instanceof ResourceInUseException) {
      console.log(`Table "${TABLE_NAME}" already exists. Skipping creation.`);
      await ensureGsi2(TABLE_NAME);
      return;
    }
    throw error;
  }

  console.log("Waiting for table to become ACTIVE...");
  await waitUntilTableExists(
    { client, maxWaitTime: 60 },
    { TableName: TABLE_NAME },
  );
  console.log("Table is ready.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
