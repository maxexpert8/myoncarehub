// This is the main JavaScript file for the Shopify Flow action extension
// It handles URL shortening for individual line items from an order

/**
 * Main handler for the Flow action
 * @param {Object} input - The input data from Shopify Flow
 * @returns {Promise<Object>} - The response for Shopify Flow
 */

interface ShopifyInput {
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

export default async function (input: ShopifyInput) {
  const { shopify, inputData } = input;
  const shopDomain = shopify.shop.domain;
  const shop_id = shopify.shop.id;
  const { 
    lineItemLongUrl, 
    lineItemId, 
    orderId,
    orderURLs,
    lineItemQuantity,
    patientId,
    pathwayId,
    taskId
  } = inputData;
  const apiUrl = "https://myoncarehub.gadget.app/flow-ext/fulfill";
  try {
    if (!lineItemLongUrl) {
      return {
        return_value: {
          success: false,
          saved: false,
          errorMessage: "Target URL is required",
          lineItemId
        }
      };
    }
    if (!lineItemId) {
      return {
        return_value: {
          success: false,
          saved: false,
          errorMessage: "Line item ID is required"
        }
      };
    }
    const shortenedUrlResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          url: lineItemLongUrl,
          lineItemId,
          orderId,
          orderURLs,
          lineItemQuantity: lineItemQuantity || 1,
          patientId,
          pathwayId,
          taskId,
          source: 'shopify_flow',
          shopDomain,
          shopId: shop_id
        }
      })
    });
    if (!shortenedUrlResponse.ok) {
      const errorData = await shortenedUrlResponse.json();
      throw new Error(`URL shortening failed: ${errorData.message || 'Unknown error'}`);
    }
    const shortenedUrlData = await shortenedUrlResponse.json();
    if (!shortenedUrlData || !shortenedUrlData.shortUrl) {
      throw new Error('Response format invalid: Missing shortUrl in response');
    }
    const shortUrl = shortenedUrlData.shortUrl;
    return {
      return_value: {
        success: true,
        saved: true,
        shortUrl,
        lineItemId
      }
    };
  } catch (error) {
    return {
      return_value: {
        success: false,
        saved: false,
        errorMessage: error instanceof Error ? `Error shortening URL: ${error.message}` : 'An unexpected error occurred',
      }
    };
  }
}