import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "orderFulfillmentStatus" model, go to https://myoncarehub.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

export const schema: GadgetModel = {
  type: "gadget/model-schema/v1",
  storageKey: "ncHmQBc4Sccn",
  fields: {
    order: {
      type: "belongsTo",
      parent: { model: "shopifyOrder" },
      storageKey: "mlDEh8ab_wkD::jbdX48BgnrjA",
    },
    shop: {
      type: "belongsTo",
      parent: { model: "shopifyShop" },
      storageKey: "ncHmQBc4Sccn-BelongsTo-Shop",
    },
    status: {
      type: "enum",
      acceptMultipleSelections: false,
      acceptUnlistedOptions: false,
      options: ["pending", "in_progress", "completed"],
      validations: { required: true },
      storageKey: "55nrWkAWkePK::0YrVVwTSj47p",
    },
  },
};
