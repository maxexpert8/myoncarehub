import { RouteHandler } from "gadget-server";
import jwt from "jsonwebtoken";

// Interfaces
//Line item structure from Shopify
interface LineItem {
  id: string;
  name?: string;
  title?: string;
  quantity?: number;
  longURL: string; // URL to be shortened
  lineItemPic?: string; // Optional picture URL}[];
  shortUrl?: string; // Shortened URL
}
//Line items structure for processing
interface LineItems {
  lineItem?: {
    id?: string;
    name?: string;
    title?: string;
    quantity?: number;
    longURL?: string; // URL to be shortened
    lineItemPic?: string; // Optional picture URL}[];
    shortUrl?: string; // Shortened URL
  }[]
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
  lineItems: [LineItem];
  shortUrl: string;
  lineItemId: string;
}
//Result of processing and storing a line item
interface FlowProcessingResult {
  saveSuccess: boolean;
  success: boolean;
  lineItems: [LineItem];
  orderUrls: string;
}
interface saveOrderMetafieldResult {
  saveSuccess: boolean;
  orderURLs: string;
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
      logger.debug({ shortURL: data.shortURL }, "Short URL generated successfully");
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
  newEntry: [{ lineItemId: string, shortUrl: string }],
  logger: any
): Promise<saveOrderMetafieldResult> {
  const accessToken = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!accessToken) {
    logger.error("SHOPIFY_ADMIN_TOKEN environment variable is not set");
    return {
      saveSuccess: false,
      orderURLs: ""
    };
  }
  logger.debug({ newEntry }, "Saving order metafield with short URLs");
  const adminApiUrl = `https://${shopDomain}/admin/api/2023-10/graphql.json`;
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
  const mutationVariables = {
    metafields: [
      {
        ownerId: orderId,
        namespace :"myoncare",
        key:  "orderurls",
        type: "json",
        value: JSON.stringify(newEntry),
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
    return {
      saveSuccess: false,
      orderURLs: ""
    };
  }
  logger.info("Successfully saved order metafield with short URLs");
  logger.debug({ responseBody }, "mutation Response");
  return {
    saveSuccess: true,
    orderURLs: JSON.stringify(newEntry)
  };
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
  const TOKEN_EXPIRY_BUFFER_SEC = 30;
  if (isValid && timeRemaining < TOKEN_EXPIRY_BUFFER_SEC) {
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

  const initialToken = jwt.sign(
  {
    Username: "myonclinic Webshop",
    iat: Math.floor(Date.now() / 1000),
    aud: "myoncare-shortener",
    iss: "shopify-flow-action"
  },
  process.env.MYONCARE_API_TOKEN,
  {
    algorithm: 'HS256',
    expiresIn: '5m'
  }
);
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
async function processLineItems(
  lineItems: LineItem[] | any,
  logger: any
): Promise<LineItemProcessingResult> {
  try {
    const shortURLs: any = [];
    const lineItemsIds: any = [];
    const updatedLineItems: [LineItem] = [{"id": "", "longURL": ""}];
    for (const lineItem of lineItems) {
      var urlData: UrlData = {
        longURL: lineItem.longURL,
        firebasePatientId: "0",
        carepathwayId: 0,
        caretaskId: 0,
        maxClicksCount: parseInt(String(lineItem.quantity || "1")) > 0 ? parseInt(String(lineItem.quantity || "1")) : 1,
      };
      var shortUrl = await shortenUrl(urlData, logger);
      shortURLs.push(shortUrl);
      lineItemsIds.push(lineItem.id);
      updatedLineItems.push({
        id: lineItem.id,
        longURL: lineItem.longURL,
        shortUrl: shortUrl,
        lineItemPic: lineItem.lineItemPic || "",
        quantity: lineItem.quantity || 1,
      });
      logger.debug({ shortUrl }, "Short URL generated for line item");
    }
    logger.debug({ shortURLs }, "Short URLs generated for line items");
    logger.debug({ lineItems }, "line items");
    updatedLineItems.shift(); // Remove the dummy item to start with an empty array
    return {
      lineItems:  updatedLineItems ,
      success: shortURLs.length == lineItems.length ? true : false,
      lineItemId: lineItemsIds,
      shortUrl: shortURLs.length == lineItems.length ? shortURLs : []
    };
  } catch (error) {
    logger.error({ error, lineItemId: lineItems[0].id }, "Error processing line item");
    return {
      success: false,
      lineItems: [{ id: lineItems[0].id, longURL: lineItems[0].longURL }],
      lineItemId: lineItems[0].id || "",
      shortUrl: ""
    };
  }
}

/**
 * Processes a Shopify Flow request to generate short URLs
 * @param request The incoming request, could be traditional or new format
 * @param logger Logger instance for debugging
 * @returns Processing result
 */
async function processFlow(request: any, logger: any): Promise<FlowProcessingResult> {
  const lineItemIDs = request.properties.lineItemsIDs || "";
  const lineItemsIDs = lineItemIDs.split(",").map((id: string) => id.trim()).filter((id: string) => id);
  const lineItemQuantities = request.properties.lineItemQuantities || "";
  const lineItemsQuantities = lineItemQuantities.split(",").map((id: string) => id.trim()).filter((id: string) => id);
  const lineItemPics = request.properties.lineItemsPics || "";
  const lineItemsPics = lineItemPics.split(",").map((id: string) => id.trim()).filter((id: string) => id);
  const lineItemLongUrls = request.properties.lineItemLongUrls || "";
  const lineItemsLongUrls = lineItemLongUrls.split(",").map((id: string) => id.trim()).filter((id: string) => id);

  if (lineItemsIDs.length !== lineItemsQuantities.length || lineItemsIDs.length !== lineItemsLongUrls.length) {
    logger.error("Line items IDs, quantities and URLs do not match in length");
    return {
      saveSuccess: false,
      success: false,
      lineItems: [{"id": "", "longURL": ""}],
      orderUrls: "",
    };
  }
  if (lineItemsIDs.length === 0) {
    logger.warn("No line items found in request");
    return {
      saveSuccess: false,
      success: false,
      lineItems: [{"id": "", "longURL": ""}],
      orderUrls: "",
    };
  }
  logger.debug({ lineItemsIDs, lineItemsQuantities, lineItemsLongUrls, lineItemsPics }, "Line items to process");
  const lineItems: [LineItem] = [{"id": "", "longURL": ""}]; // Initialize with a dummy item to avoid empty array issues
  lineItems.shift(); // Remove the dummy item to start with an empty array
  for (let i = 0; i < lineItemsIDs.length; i++) {
     let lineItem: LineItem = {
      id: lineItemsIDs[i],
      quantity: parseInt(lineItemsQuantities[i]) || 1,
      longURL: lineItemsLongUrls[i],
      lineItemPic: lineItemsPics[i] || "",
    }
    lineItems.push(lineItem);
  }
  logger.debug({ lineItems }, "Line items to process");
  const result = await processLineItems(lineItems, logger);
  logger.debug({ result }, "Processed line items result");
  const newEntry:any = [];
  if (result.success) {
    for (let i = 0; i < result.shortUrl.length; i++) {
      newEntry.push({ lineItemId: result.lineItemId[i], shortUrl: result.shortUrl[i] });
    };
  }
  const { saveSuccess, orderURLs } = result.success ? await saveOrderMetafield(request.shopify_domain, request.properties.orderId, newEntry, logger) : {saveSuccess: false,orderURLs:""};
  if (!saveSuccess) {
    logger.warn("Failed to save short URL mapping as order metafield");
  }
  return {
    saveSuccess: saveSuccess,
    success: result.success,
    lineItems: result.lineItems,
    orderUrls: orderURLs
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
    await reply.code(max.success ? 200 : 400).send({
      return_value: {
        success: max.success,
        saved: max.saveSuccess,
        lineItems: JSON.stringify(max.lineItems) || "",
        orderURLs: max.orderUrls || "",
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