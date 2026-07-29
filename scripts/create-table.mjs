// DynamoDB `RakutenRankings` テーブルを作成するワンショットスクリプト。
// 使い方: npm run db:create-table
import {
  CreateTableCommand,
  DynamoDBClient,
  ResourceInUseException,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";

const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? "RakutenRankings";
const ENDPOINT = process.env.DYNAMODB_ENDPOINT;

const client = new DynamoDBClient({
  region: REGION,
  ...(ENDPOINT ? { endpoint: ENDPOINT } : {}),
});

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
        ],
      }),
    );
  } catch (error) {
    if (error instanceof ResourceInUseException) {
      console.log(`Table "${TABLE_NAME}" already exists. Skipping creation.`);
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
