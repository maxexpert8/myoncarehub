import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "customerOrderHistory" model, go to https://myoncarehub.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

export const schema: GadgetModel = {
  type: "gadget/model-schema/v1",
  storageKey: "0WhqzY7JvWRg",
  fields: {
    customer: {
      type: "belongsTo",
      parent: { model: "shopifyCustomer" },
      storageKey: "CSE-DEjHaYhg::1OEcw9HhZPdl",
    },
    customerId: {
      type: "number",
      validations: { required: true },
      storageKey: "V1fzMQWqgwC0::dX3DdBDOb1FW",
    },
    orderDate: {
      type: "dateTime",
      includeTime: true,
      validations: { required: true },
      storageKey: "BtMkMWoH2TGz::6vfaLZUtV9gv",
    },
    orderId: {
      type: "number",
      validations: { required: true },
      storageKey: "4oW37wgVgyeX::ZFojacxMDhA4",
    },
    shop: {
      type: "belongsTo",
      parent: { model: "shopifyShop" },
      storageKey: "0WhqzY7JvWRg-BelongsTo-Shop",
    },
  },
};
