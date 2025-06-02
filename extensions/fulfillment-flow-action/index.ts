// fulfillment-flow-action/index.ts
import type { ShopifyFlowActionInput, ShopifyFlowActionOutput } from './types';

// Type Definitions
interface UrlShortenerRequest {
  urls: string;
  lineItemIds: string;
  orderId: string;
  lineItemQuantities?: string;
  lineItemsPics?: string;
  source: 'shopify_flow';
  shopDomain: string;
  shopId: string;
}

interface UrlShortenerResponse {
  success: boolean;
  shortUrl?: string;
  message?: string;
  errors?: FlowError[];
}

interface FlowError {
  code: string;
  field?: string;
  message: string;
}

// Constants
const API_URL = "https://myoncarehub.gadget.app/flow-ext/fulfill";
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RETRIES = 2;

// Utilities
const validateUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const createError = (code: string, message: string, field?: string): FlowError => ({
  code,
  field,
  message
});

const validateInputs = (inputData: any): FlowError[] => {
  const errors: FlowError[] = [];
  
  if (!inputData.lineItemLongUrl) {
    errors.push(createError('MISSING_URL', 'Target URL is required', 'lineItemLongUrl'));
  } else if (!validateUrl(inputData.lineItemLongUrl)) {
    errors.push(createError('INVALID_URL', 'URL must be a valid HTTPS URL', 'lineItemLongUrl'));
  }

  if (!inputData.lineItemId) {
    errors.push(createError('MISSING_LINE_ITEM_ID', 'Line item ID is required', 'lineItemId'));
  }

  if (!inputData.orderId) {
    errors.push(createError('MISSING_ORDER_ID', 'Order ID is required', 'orderId'));
  }

  return errors;
};

const makeApiRequest = async (payload: UrlShortenerRequest): Promise<UrlShortenerResponse> => {
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

    return await response.json() as UrlShortenerResponse;
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
  // Safe logging (redacts sensitive fields)
  const safeLogData = {
    ...input.inputData,
    patientId: input.inputData.patientId ? '[REDACTED]' : undefined,
    pathwayId: input.inputData.pathwayId ? '[REDACTED]' : undefined
  };
  console.debug('Processing request:', safeLogData);

  // Input Validation
  const validationErrors = validateInputs(input.inputData);
  if (validationErrors.length > 0) {
    console.warn('Input validation failed:', validationErrors);
    return {
      return_value: {
        success: false,
        saved: false,
        errors: validationErrors,
        lineItemId: input.inputData.lineItemIds
      }
    };
  }

  try {
    // Prepare request payload
    const payload: UrlShortenerRequest = {
      urls: input.inputData.lineItemLongUrls!,
      lineItemIds: input.inputData.lineItemIds!,
      lineItemsPics: input.inputData.lineItemsPics!,
      orderId: input.inputData.orderId!,
      lineItemQuantities: input.inputData.lineItemQuantities ,
      source: 'shopify_flow',
      shopDomain: input.shopify.shop.domain,
      shopId: input.shopify.shop.id
    };

    // Execute with retries
    const result = await withRetries<UrlShortenerResponse>(
      () => makeApiRequest(payload),
      MAX_RETRIES
    );

    if (!result.success || !result.shortUrl) {
      const apiError = createError(
        'SHORTENER_API_ERROR',
        result.message || 'URL shortening failed',
        'lineItemLongUrl'
      );
      return {
        return_value: {
          success: false,
          saved: false,
          errors: [apiError],
          lineItemId: input.inputData.lineItemIds
        }
      };
    }

    // Success case
    return {
      return_value: {
        success: true,
        saved: true,
        shortUrl: result.shortUrl,
        lineItemId: input.inputData.lineItemIds
      }
    };

  } catch (error) {
    console.error('URL shortening failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return {
      return_value: {
        success: false,
        saved: false,
        errorMessage: `Failed to shorten URL: ${errorMessage}`,
        lineItemId: input.inputData.lineItemIds,
        errors: [createError(
          'PROCESSING_ERROR',
          errorMessage
        )]
      }
    };
  }
}