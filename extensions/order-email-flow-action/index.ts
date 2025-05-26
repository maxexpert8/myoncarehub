// order-email-flow-action/index.ts

// Type Definitions
interface OrderEmailRequest {
  orderId: string;
  source: 'shopify_flow';
  shopDomain: string;
  shopId: string;
}
interface OrderEmailResponse {
  success: boolean;
  errorMessage?: string;
  errors?: FlowError[];
}
interface FlowError {
  code: string;
  field?: string;
  message: string;
}
interface ShopifyFlowActionInput {
  shopify: {
    shop: {
      domain: string;
      id: string;
    };
  };
  inputData: {
    orderId?: string;
  };
}
interface ShopifyFlowActionOutput {
  return_value: {
    success: boolean;
    errorMessage?: string;
    errors?: Array<{
      code: string;
      field?: string;
      message: string;
    }>;
  };
}
// Constants
const API_URL = "https://myoncarehub.gadget.app/flow-ext/order-email";
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RETRIES = 2;

// Utilities
const createError = (code: string, message: string, field?: string): FlowError => ({
  code,
  field,
  message
});

const validateInputs = (inputData: any): FlowError[] => {
  const errors: FlowError[] = [];
  if (!inputData.orderId) {
    errors.push(createError('MISSING_ORDER_ID', 'Order ID is required', 'orderId'));
  }
  return errors;
};

const makeApiRequest = async (payload: OrderEmailRequest): Promise<OrderEmailResponse> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Source': 'shopify_flow_action'
      },
      body: JSON.stringify({
        properties: payload
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
    }

    return await response.json() as OrderEmailResponse;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
};

const withRetries = async <T>(
  fn: () => Promise<T>,
  maxRetries: number
): Promise<T> => {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      attempt++;
      if (attempt <= maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  throw lastError;
};

// Main Handler
export default async function (input: ShopifyFlowActionInput): Promise<ShopifyFlowActionOutput> {
  // Input Validation
  const validationErrors = validateInputs(input.inputData);
  if (validationErrors.length > 0) {
    console.warn('Input validation failed:', validationErrors);
    return {
      return_value: {
        success: false,
        errors: validationErrors,
      }
    };
  }

  try {
    // Prepare request payload
    const payload: OrderEmailRequest = {
      orderId: input.inputData.orderId!,
      source: 'shopify_flow',
      shopDomain: input.shopify.shop.domain,
      shopId: input.shopify.shop.id
    };

    // Execute with retries
    const result = await withRetries<OrderEmailResponse>(
      () => makeApiRequest(payload),
      MAX_RETRIES
    );

    if (!result.success || (result.errors && result.errors.length > 0)) {
      console.error('API returned errors:', result.errors);
      const apiError = createError(
        'OrderEmail_API_ERROR',
        result?.errorMessage || 'URL shortening failed',
        'lineItemLongUrl'
      );
      return {
        return_value: {
          success: false,
          errors: [apiError],
        }
      };
    }

    // Success case
    return {
      return_value: {
        success: true,
      }
    };

  } catch (error) {
    console.error('Order Email failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return {
      return_value: {
        success: false,
        errorMessage: `Failed to Send Email: ${errorMessage}`,
        errors: [createError(
          'PROCESSING_ERROR',
          errorMessage
        )]
      }
    };
  }
}