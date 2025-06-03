import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "emailLog" model, go to https://myoncarehub.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

export const schema: GadgetModel = {
  type: "gadget/model-schema/v1",
  storageKey: "RODgtLOhd4oI",
  comment:
    "This model tracks sent emails for deduplication purposes, storing information about the email itself and the order it was sent for.",
  fields: {
    emailAddress: {
      type: "email",
      validations: { required: true },
      storageKey: "SDOHFyYMaafM",
    },
    emailType: {
      type: "enum",
      acceptMultipleSelections: false,
      acceptUnlistedOptions: false,
      options: ["order_confirmation", "fulfillment", "other"],
      validations: { required: true },
      storageKey: "3Cv4QVqbB-Qi",
    },
    messageId: {
      type: "string",
      validations: { required: true },
      storageKey: "uUzqTJCwan2r",
    },
    orderId: {
      type: "string",
      validations: { required: true },
      storageKey: "PcS0D6DXObIk",
    },
    sentAt: {
      type: "dateTime",
      includeTime: true,
      validations: { required: true },
      storageKey: "A0HI2AKhBacH",
    },
    shop: {
      type: "belongsTo",
      validations: { required: true },
      parent: { model: "shopifyShop" },
      storageKey: "xadNwOCQ-vSD",
    },
    status: {
      type: "enum",
      acceptMultipleSelections: false,
      acceptUnlistedOptions: false,
      options: ["sent", "failed", "bounced"],
      validations: { required: true },
      storageKey: "4DtSmOCuvM16",
    },
  },
};
