import { logger } from ".gadget/server/dist-esm";

/**
 * Order Email Flow Action Extension
 * 
 * This extension processes Shopify Flow data for order email actions.
 * It validates the incoming data, extracts order ID and other relevant
 * information, and forwards it to our backend endpoint.
 */
interface FlowInput {
  shop: { domain: string };
  order: {
    id: string;
    customer?: object;
    email?: string;
  };
  actionId?: string;
}

// Function to validate the input data from Shopify Flow
function validateInput(input: FlowInput) {
  // Check if input exists and has the expected properties
  if (!input || typeof input !== 'object') {
    throw new Error('Input is missing or invalid');
  }

  // Check if order data is present
  if (!input.order || typeof input.order !== 'object') {
    throw new Error('Order data is missing or invalid');
  }

  // Check if order ID exists
  if (!input.order.id) {
    throw new Error('Order ID is missing');
  }
}

// Function to transform Shopify gid to numeric ID
function parseShopifyGid(gid: string) {
  if (!gid) return null;
  // Shopify GIDs are in the format gid://shopify/Order/1234567890
  const parts = gid.split('/');
  return parts[parts.length - 1];
}

// Retry helper with exponential backoff
async function retryWithExponentialBackoff<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 500
): Promise<T> {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      return await fn(); // Try the function
    } catch (error: any) {
      if (attempt === retries) throw error;

      const wait = delay * 2 ** attempt; // Exponential backoff
      console.warn(`Retry attempt ${attempt + 1} after ${wait}ms due to error: ${error.message}`);
      await new Promise(res => setTimeout(res, wait));
      attempt++;
    }
  }
  throw new Error('Unexpected retry failure'); // This should never be reached
}


/**
 * Main function that processes the input from Shopify Flow
 * @param {Object} input - The data passed from Shopify Flow
 * @returns {Object} - Response to be returned to Shopify Flow
 */
export default async function(input: FlowInput): Promise<object> {
  try {
    // Log the incoming data for debugging
    console.log('Received order email flow action input:', JSON.stringify(input));

    // Validate the input
    validateInput(input);

    // Extract order ID from input
    const orderId = input.order.id;

    if (!orderId) {
      throw new Error('Could not parse order ID from input');
    }else{
      logger.debug({orderId}, 'Parsed order ID from input');
    }

    // Extract shop domain from input
    const shopDomain = input.shop.domain;
    if (!shopDomain) {
      throw new Error('Shop domain is missing');
    }

    // Prepare data for backend request
    const requestData = {
      orderId,
      shopDomain,
      flowActionId: input.actionId || null,
    };
    logger.debug({requestData},'Prepared request data for backend:', );
    // Make request to our backend endpoint
    const response = await retryWithExponentialBackoff(() =>
      fetch('https://myoncarehub.gadget.app/flow-ext/order-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      })
    );


    // Check if the request was successful
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Backend request failed with status ${response.status}: ${errorText}`);
    }

    // Parse the response
    const responseData = await response.json();

    // Return success response to Shopify Flow
    return {
      return_value: {
        success: true,
      }
    };

  }catch (error: any) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in order email flow action:', message);
     return {
      return_value: {
        success: false,
      }
    };
  }
}