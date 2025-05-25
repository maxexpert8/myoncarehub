import type { GadgetSettings } from "gadget-server";

export const settings: GadgetSettings = {
  type: "gadget/settings/v1",
  frameworkVersion: "v1.3.0",
  plugins: {
    connections: {
      shopify: {
        apiVersion: "2025-04",
        enabledModels: [
          "shopifyCustomer",
          "shopifyFulfillment",
          "shopifyOrder",
        ],
        type: "partner",
        scopes: [
          "read_fulfillments",
          "read_order_edits",
          "read_products",
          "read_shipping",
          "write_customers",
          "write_inventory",
          "write_orders",
        ],
        customerAuthenticationEnabled: false,
      },
    },
  },
};
