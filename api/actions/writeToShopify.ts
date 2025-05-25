/**
 * Action for making GraphQL mutations to Shopify's Admin API.
 *
 * This is the recommended way to write data back to Shopify from your Gadget app.
 *
 * This action should be run in the background using `api.enqueue()`
 * to allow for retries if Shopify's rate limit is hit.
 *
 * @returns The result of the GraphQL mutation from Shopify's API
 */
import { ActionOptions } from "gadget-server";

export const run: ActionRun = async ({ params, logger, api, connections }) => {
  if (!params.shopId || !params.mutation) {
    throw new Error("shopId and mutation are required");
  }

  const shopify = await connections.shopify.forShopId(params.shopId);

  return await shopify.graphql(params.mutation, params.variables);
};

export const params = {
  shopId: {
    type: "string",
  },
  mutation: {
    type: "string",
  },
  variables: {
    type: "object",
    additionalProperties: true,
  },
};

export const options: ActionOptions = {
  timeoutMS: 300000, // 5 minutes to allow for potential Shopify API delays
  returnType: true,
  triggers: { api: true }
};
