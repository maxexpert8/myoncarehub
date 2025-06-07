import jwt from 'jsonwebtoken';
import { generateOrderEmailTemplate, formatDate, formatCurrency } from "../templates/orderEmail";
import { TransactionalEmailsApi, TransactionalEmailsApiApiKeys } from "@getbrevo/brevo";

// Error classes
export class FulfillmentProcessingError extends Error {
  constructor(message: string, public orderId?: string, public lineItemId?: string) {
    super(message);
    this.name = 'FulfillmentProcessingError';
  }
}

export class EmailDeliveryError extends Error {
  constructor(message: string, public orderId?: string, public emailAddress?: string) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}

// Interfaces
//Line item structure from Shopify
interface ShopifyOrderWebhook {
  id: number;
  name: string;
  email: string;
  processed_at: string;
  created_at: string;
  customer?: {
    id: number;
    first_name?: string;
    last_name?: string;
    email?: string;
  };
  line_items: Array<{
    id: number;
    name: string;
    title: string;
    quantity: number;
    price: string;
    product_id?: number;
    variant_id?: number;
  }>;
  total_price: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
}
interface LineItem {
  id: string;
  name: string;
  quantity: number;
  image: string;
  shortUrl: string;
  longURL: string;
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
  lineItems: LineItem[];
  shortUrls: string[];
  lineItemsName: string[];
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

let tokenCache: TokenCache | null = null;


// HELPER FUNCTIONS

/** Checks if order was already processed */
export async function checkProcessingStatus(orderId: string, api: any, logger: any) {
  try {
    const metafields = await api.shopify.metafield.findMany({
      filter: {
        ownerId: { equals: `gid://shopify/Order/${orderId}` },
        namespace: { equals: "myoncare" }
      }
    });

    const processed = metafields.some((m: any) => m.key === "processing_complete");
    return { processed, metafields };
  } catch (error) {
    logger.error({ error, orderId }, "Error checking processing status");
    return { processed: false, metafields: [] };
  }
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
export async function processLineItems(
  lineItems: LineItem[] | any,
  logger: any
): Promise<LineItemProcessingResult> {
  try {
    const shortURLs: any = [];
    const lineItemsNames: any = [];
    const updatedLineItems: LineItem[] = [{
      id: "",
      name: "",
      quantity: 0,
      image: "",
      shortUrl: "",
      longURL: ""
    }];
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
      lineItemsNames.push(lineItem.name);
      updatedLineItems.push({
        id: lineItem.id,
        longURL: lineItem.longURL,
        shortUrl: shortUrl,
        image: lineItem.image,
        quantity: lineItem.quantity || 1,
        name: lineItem.name
      });
      logger.debug({ shortUrl }, "Short URL generated for line item");
    }
    logger.debug({ shortURLs }, "Short URLs generated for line items");
    logger.debug({ lineItems }, "line items");
    updatedLineItems.shift(); // Remove the dummy item to start with an empty array
    return {
      lineItems:  updatedLineItems ,
      success: shortURLs.length == lineItems.length ? true : false,
      lineItemsName: lineItemsNames,
      shortUrls: shortURLs.length == lineItems.length ? shortURLs : []
    };
  } catch (error) {
    logger.error({ error, lineItemId: lineItems[0].id }, "Error processing line item");
    return {
      success: false,
      lineItems: [{
        id: lineItems[0].id, longURL: lineItems[0].longURL,
        name: '',
        quantity: 0,
        image: '',
        shortUrl: ''
      }],
      lineItemsName: [],
      shortUrls: []
    };
  }
}

/** Sends the order confirmation email */
export async function sendOrderEmail(order: ShopifyOrderWebhook, lineItems: any,customerName: string, logger: any) {
  const result = { success: false, messageId: "" };

  try {
    if (!process.env.BREVO_API_TOKEN) {
      throw new Error("Brevo API token not configured");
    }

    const { subject, html } = generateOrderEmailTemplate({
      orderNumber: order.name,
      orderDate: order.processed_at || order.created_at,
      items: lineItems,
      customerName: customerName
    });

    const brevo = new TransactionalEmailsApi();
    brevo.setApiKey(TransactionalEmailsApiApiKeys.apiKey,process.env.BREVO_API_TOKEN);

    const emailResponse = await brevo.sendTransacEmail({
      sender: { name: "MyOnClinic Shop", email: "marketing@myon.clinic" },
      to: [{ email: order.email }],
      subject: subject,
      htmlContent: html
    });

    result.messageId = emailResponse.body?.messageId || "";
    result.success = !!result.messageId;

    return result;
  } catch (error) {
    logger.error({ error, orderId: order.id }, "Error sending order email");
    return result;
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
export async function saveOrderMetafield(
  shopDomain: string,
  orderId: string,
  newEntry: any,
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
/** URL Shortening Helper (from original extension) */
async function shortenUrl(urlData: { longURL: string; maxClicksCount: number }, logger: any): Promise<string> {
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
    logger.info({ urlData }, "Shortening URL request data");
    logger.info({ response }, "Shortening URL response status");
    logger.info({ token }, "Shortening URL request token");
    const data = await response.json();
    return data.shortURL || "";
  } catch (error) {
    logger.error({ error }, "URL shortening failed");
    return "";
  }
}

/** Auth Token Helper (from original extension) */
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
