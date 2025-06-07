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
          "shopifyFile",
          "shopifyFulfillment",
          "shopifyOrder",
          "shopifyOrderLineItem",
          "shopifyProduct",
          "shopifyProductMedia",
        ],
        type: "partner",
        scopes: [
          "read_fulfillments",
          "read_order_edits",
          "read_products",
          "write_products",
          "read_orders",
          "write_orders",
          "read_customers",
          "write_customers",
          "read_files",
          "read_inventory",
          "write_inventory",
          "read_all_orders",
        ],
        customerAuthenticationEnabled: false,
      },
    },
  },
};
