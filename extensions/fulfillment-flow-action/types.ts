// types.ts
export interface ShopifyFlowActionInput {
  shopify: {
    shop: {
      domain: string;
      id: string;
    };
  };
  inputData: {
    lineItemLongUrl?: string;
    lineItemId?: string;
    orderId?: string;
    orderURLs?: any;
    lineItemQuantity?: number;
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