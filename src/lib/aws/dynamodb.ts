import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { env } from "@/lib/config/env";

const client = new DynamoDBClient({
  region: env.aws.region,
  ...(env.aws.dynamoEndpoint ? { endpoint: env.aws.dynamoEndpoint } : {}),
});

export const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

export const TABLE_NAME = env.aws.dynamoTableName;
