// types.ts
export interface ShopifyFlowActionInput {
  shopify: {
    shop: {
      domain: string;
      id: string;
    };
  };
  inputData: {
    lineItemLongUrls?: string;
    lineItemIds?: string;
    orderId?: string;
    lineItemsPics?: string;
    lineItemQuantities?: string;
    patientId?: string;
    pathwayId?: string;
    taskId?: string;
  };
}

export interface ShopifyFlowActionOutput {
  return_value: {
    success: boolean;
    saved: boolean;
    shortUrl?: string;
    lineItemId?: string;
    errorMessage?: string;
    errors?: Array<{
      code: string;
      field?: string;
      message: string;
    }>;
  };
}