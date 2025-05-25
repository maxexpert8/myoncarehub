import { RouteHandler } from "gadget-server";
import jwt from "jsonwebtoken";

// Interfaces
//Line item structure from Shopify
interface LineItem {
  id: string;
  name?: string;
  title?: string;
  quantity?: number;
  properties?: Array<{ name: string; value: string }>;
  [key: string]: any; // For other properties that might exist
}

//Data structure for URL shortening MyOnCare API request
interface UrlData {
  longURL: string;
  firebasePatientId?: string;
  carepathwayId?: number;
  caretaskId?: number;
  maxClicksCount: number;
}

//Result of processing a line item
interface LineItemProcessingResult {
  success: boolean;
  message: string;
  lineItemId: string;
  shortUrl: string;
}

//Result of processing and storing a line item
interface FlowProcessingResult {
  saveSuccess: boolean;
  processingResult: LineItemProcessingResult;
}

// Token cache for reusing JWT tokens
interface TokenCache {
  accessToken: string;
  expiresAt: number; // timestamp in ms when the token expires
  createdAt: number; // timestamp in ms when the token was created
}

// Global variable to store the token cache
let tokenCache: TokenCache | null = null;

/**
 * Saves the generated short URLs to the order metafield in Shopify
 * @param shopDomain The Shopify shop domain
 * @param orderId The order ID
 * @param newEntry The data to save in the metafield
 * @param logger Logger instance for debugging
 * @returns true if successful, false otherwise
 */
async function saveOrderMetafield(
  shopDomain: string,
  orderId: string,
  newEntry: { lineItemId: string, shortUrl: string },
  logger: any
): Promise<boolean> {
  const accessToken = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!accessToken) {
    logger.error("SHOPIFY_ADMIN_TOKEN environment variable is not set");
    return false;
  }

  const adminApiUrl = `https://${shopDomain}/admin/api/2023-10/graphql.json`;
  const existingMetafieldQuery = `
    query {
      order(id: "${orderId}") {
        metafield(namespace: "myoncare", key: "orderurls") {
          value
        }
      }
    }
  `;
  const mutationQuery = `
    mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          namespace
          key
          value
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  // Fetch and parse existing metafield value  
  const existingMetafieldResponse = await fetch(adminApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query: existingMetafieldQuery }),
  });
  const existingMetafieldData = await existingMetafieldResponse.json();
  const existingValueRaw = existingMetafieldData?.data?.order?.metafield?.value || "[]";
  const existingArray = JSON.parse(existingValueRaw);

  // Check if the new entry already exists in the metafield
  const existingEntry = existingArray.find((entry: any) => entry.lineItemId === newEntry.lineItemId);
  if (existingEntry) {
    logger.info(`Short URL already exists for lineItemId ${newEntry.lineItemId}`);
    return false
  }
  
  // Merge the new entry with the existing array and sort by lineItemId
  const mergedArray = [...existingArray, newEntry];
  logger.debug({ existingArray }, "Existing metafield value:");
  logger.debug({ mergedArray }, "merged metafield value:");
  mergedArray.sort((a, b) => a.lineItemId.localeCompare(b.lineItemId));
  const mutationVariables = {
    metafields: [
      {
        ownerId: orderId,
        namespace :"myoncare",
        key:  "orderurls",
        type: "json",
        value: JSON.stringify(mergedArray),
      }
    ]
  };

  // Send the mutation to save the updated metafield
  const response = await fetch(adminApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query: mutationQuery,variables: mutationVariables })
  });
  const responseBody = await response.json();
  if (responseBody.data?.metafieldsSet?.userErrors?.length > 0) {
    return false;
  }
  logger.info("Successfully saved order metafield with short URLs");
  logger.debug({ responseBody }, "mutation Response");
  return true;
}

/**
 * Checks if the cached token is still valid
 * @param logger Logger instance for debugging
 * @returns true if token is valid, false otherwise
 */
function isTokenValid(logger: any): boolean {
  if (!tokenCache) {
    logger.info("No token in cache");
    return false;
  }
  const now = Date.now();
  const isValid = now < tokenCache.expiresAt;
  const timeRemaining = Math.floor((tokenCache.expiresAt - now) / 1000);  
  if (isValid && timeRemaining < 30) {
    logger.info("Token expiring soon, marking as invalid");
    return false;
  }
  
  return isValid;
}

/**
 * Generates token from the auth endpoint
 * @param logger Logger instance for debugging
 * @returns The access token to use for the URL shortening API
 */
async function generateDynamicToken(logger: any): Promise<string> {
  if (!process.env.MYONCARE_API_TOKEN) {
    logger.error("MYONCARE_API_TOKEN environment variable is not set");
    return "";
  }

  const initialToken = jwt.sign({Username: "myonclinic Webshop"}, process.env.MYONCARE_API_TOKEN, { algorithm: 'HS256' });;
  if (!initialToken) {
    logger.error("Failed to generate initial JWT token");
    return "";
  };

  const response = await fetch("https://internal.myoncare.care/firebaseManager/webshop/token/request", {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${initialToken}`
    }
  });
  if (!response.ok) {
    const errorText = await response.text();
    logger.error({
      statusCode: response.status,
      error: errorText,
      url: "https://internal.myoncare.care/firebaseManager/webshop/token/request"
    }, "Error fetching access token");
    return "";
  }
  const data = await response.json();
  if (data && data.accessToken) {
    return data.accessToken;
  } else {
    logger.error({ response: data }, "No token found in auth response");
    return "";
  }
}

/**
 * Gets a JWT token, either from cache or by generating a new one
 * @param logger Logger instance for debugging
 * @returns A valid JWT token
 */
async function getAuthToken(logger: any): Promise<string> {
  if (isTokenValid(logger)) {
    logger.info("Using cached token");
    return tokenCache!.accessToken;
  }
  
  // Generate fresh token
  const token = await generateDynamicToken(logger);
  
  if (!token) {
    return "";
  }
  
  // Cache the token
  const now = Date.now();
  tokenCache = {
    accessToken: token,
    createdAt: now,
    expiresAt: now + (300 * 1000) // 5 minutes in milliseconds
  };
  
  logger.info("New token cached");
  
  return token;
}

/**
 * Processes a line item to extract necessary data and generate a URL shortening request
 * @param shopDomain The Shopify shop domain
 * @param orderId The order ID
 * @param orderName The order name/number
 * @param lineItem The line item to process
 * @param logger Logger instance for debugging
 * @returns A processing result with success status and any short URL
 */
async function processLineItem(
  lineItem: LineItem | any,
  logger: any
): Promise<LineItemProcessingResult> {
  try {
    if (!lineItem.longURL) {
      return {
        success: false,
        message: "Missing original URL in line item properties",
        lineItemId: lineItem.id,
        shortUrl: ""
      };
    }
    const urlData: UrlData = {
      longURL: lineItem.longURL,
      firebasePatientId: lineItem.patientId || 0,
      carepathwayId: parseInt(lineItem.pathwayId || 0),
      caretaskId: parseInt(lineItem.taskId || 0),
      maxClicksCount: parseInt(String(lineItem.quantity || "1")) > 0 ? parseInt(String(lineItem.quantity || "1")) : 1,
    };

    // Call the URL shortening service
    const shortUrl = await shortenUrl(urlData, logger);
    return {
      success: shortUrl ? true : false,
      message: shortUrl ? "Successfully generated short URL" : "Failed to generate short URL",
      lineItemId: lineItem.id,
      shortUrl: shortUrl ? shortUrl : ""
    };
  } catch (error) {
    logger.error({ error, lineItemId: lineItem.id }, "Error processing line item");
    return {
      success: false,
      message: `Error processing line item: ${error instanceof Error ? error.message : String(error)}`,
      lineItemId: lineItem.id || "",
      shortUrl: ""
    };
  }
}

/**
 * Calls the URL shortening service API to generate short URLs
 * @param urlData The data to send to the URL shortening service
 * @param logger Logger instance for debugging
 * @returns The generated short URL or empty string if failed
 */
async function shortenUrl(urlData: UrlData, logger: any): Promise<string> {
  try {
    const token = await getAuthToken(logger);
    const response = await fetch("https://url.myoncare.care/url/create-limited-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(urlData)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error({
        statusCode: response.status,
        error: errorText,
        requestUrl: "https://url.myoncare.care/url/create-limited-url",
        requestData: urlData
      }, "URL shortening API error");
      return "";
    }
    
    const data = await response.json();
    if (data.shortURL) {
      return data.shortURL;
    } else {
      logger.error({ responseData: data }, "No short URL found in API response");
      return "";
    }
  } catch (error) {
    logger.error({ 
      error, 
      message: error instanceof Error ? error.message : "Unknown error", 
      urlRequest: urlData
    }, "Error in shortenUrl function");
    return "";
  }
}

/**
 * Processes a Shopify Flow request to generate short URLs
 * @param request The incoming request, could be traditional or new format
 * @param logger Logger instance for debugging
 * @returns Processing result
 */
async function processFlow(request: any, logger: any): Promise<FlowProcessingResult> {
  const lineItem = {
    id: request.properties.lineItemId || "",
    quantity: request.properties.lineItemQuantity || 1,
    longURL: request.properties.lineItemLongUrl || "",
    patientId: request.properties.patientId || 0,
    pathwayId: request.properties.pathwayId || 0,
    taskId: request.properties.taskId || 0,
  };
  const result = await processLineItem(lineItem, logger);
  const newEntry = result.success ? { lineItemId: result.lineItemId, shortUrl: result.shortUrl } : {lineItemId: "", shortUrl: ""};
  const saveSuccess = result.success ? await saveOrderMetafield(request.shopify_domain, request.properties.orderId, newEntry, logger) : false;
  if (!saveSuccess) {
    logger.warn("Failed to save short URL mapping as order metafield");
  }
  return {
    processingResult: result,
    saveSuccess: saveSuccess 
  }
}

/**
 * Route handler for Shopify Flow webhook
 */
const route: RouteHandler = async ({ request, reply, logger }) => {
  try {    
    // Process the Flow request
    const max = await processFlow(request.body, logger);
  
    // Return response with exact field names that match the Result type in schema
    await reply.code(max.processingResult.success ? 200 : 400).send({
      return_value: {
        success: max.processingResult.success,
        saved: max.saveSuccess,
        shortUrl: max.processingResult.shortUrl || "",
        lineItemId: max.processingResult.lineItemId || "",
        errorMessage: max.processingResult.success ? "" : max.processingResult.message
      }
    });
  } catch (error) {
    logger.error({ error }, "Error processing Flow webhook");
    await reply.code(500).send({
      return_value: {
        success: false,
        saved: false,
        shortUrl: "",
        lineItemId: "",
        errorMessage: error instanceof Error ? error.message : "Unknown error processing webhook"
      }
    });
  }
};

export default route;