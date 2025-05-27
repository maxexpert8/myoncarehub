import { RouteHandler } from "gadget-server";
import formData from "form-data";
import Mailgun from "mailgun.js";
import { generateOrderEmailTemplate, formatDate, formatCurrency } from "../../templates/orderEmail";

// Custom error classes for better error handling
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}
class ShopifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShopifyError';
  }
}
class MailgunError extends Error {
  statusCode?: number;
  details?: any;
  
  constructor(message: string, statusCode?: number, details?: any) {
    super(message);
    this.name = 'MailgunError';
    this.statusCode = statusCode;
    this.details = details;
  }
}
class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

interface OrderEmailRequestBody {
  orderId: string;
}
interface OrderLineItem {
  id: string;
  title: string;
  quantity: number;
  shortUrl: string;
}
interface ShopifyMetafield {
  id: number;
  namespace: string;
  key: string;
  value: string;
}
interface ShopifyOrder {
  id: string;
  name: string;
  email: string;
  processedAt: string;
  createdAt: string;
  customerId?: string;
  legacyResourceId?: string;
  shopId: string;
}

async function validateInputs(request: any, connections: any) {
 if (!request.properties || !request.properties.orderId) {
      throw new ValidationError("Missing orderId in request body");
    }
    // Validate shop authentication
    const shopId = connections.shopify.currentShopId;
    if (!shopId) {
      throw new AuthenticationError("No active shop session found");
    }
    const shopify = connections.shopify.current;
    if (!shopify) {
      throw new ShopifyError("Failed to initialize Shopify API client");
    }
    // Validate configuration
    if (!process.env.MAILGUN_API_KEY) {
      throw new ConfigurationError("Mailgun API key is not configured");
    }
    return {
      orderId :request.properties.orderId,
      shopId,
      shopify
    };
}
async function getOrder(shopId: string, orderId: string, api:any, logger: any) {
    let order: ShopifyOrder | null = await api.shopifyOrder.findOne(orderId, {
        select: {
          id: true,
          name: true, 
          email: true,
          processedAt: true,
          createdAt: true,
          customerId: true,
          legacyResourceId: true,
          shopId: true
        }
      });

    if (!order) {
      throw new ShopifyError(`Order with ID ${orderId} not found`);
    }
    const legacyIdNum = order.legacyResourceId ? Number(order.legacyResourceId) : undefined;
    if (!legacyIdNum || isNaN(legacyIdNum)) {
      throw new ValidationError("Order legacyResourceId is missing or invalid");
    }
    // Validate order belongs to current shop
    if (String(order.shopId) !== String(shopId)) {
      logger.error({ 
        orderId, 
        orderShopId: order.shopId, 
        currentShopId: shopId 
      }, "Order tenant mismatch");
      throw new AuthenticationError("Order does not belong to the authenticated shop");
    }
    return {
      legacyIdNum,
      order
    };
}
async function getCustomerData(api: any, order: any, logger: any) {
  let customer: any = null;
    if (order.customerId) {
      try {
       customer = await api.shopifyCustomer.findOne(order.customerId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        });
        logger.info({ customerId: order.customerId }, "Customer data fetched successfully");
      } catch (error) {
        logger.warn({ customerId: order.customerId, error: error instanceof Error ? error.message : 'Unknown error' }, 
          "Error fetching customer data, will proceed with order email");
        // We'll continue without customer data since the order might still have an email
      }
    } else {
      logger.info("No customer ID associated with this order");
    }

    // Validate customer email
    const customerEmail = order.email || (customer && customer.email);
    if (!customerEmail) {
      throw new ValidationError(`No email address found for order ${order.name}`);
    }

    // Safely construct customer name from available data
    const customerName = customer ? `${customer.firstName} ${customer.lastName}` : "Customer";

    return {
      customerEmail,
      customerName
    };
}
async function getOrderUrls(shopify: any, order: any, logger: any) {
    // Process order URLs from metafields using Shopify API
    let shortUrls: { lineItemId: string; shortUrl: string }[] = [];
    
    try {
      let metafieldsResponse: ShopifyMetafield[] = [];
      try {
        const metafieldsPaginated = await shopify.metafield.list({
          owner_resource: "order",
          owner_id: Number(order.legacyResourceId)
        });

        metafieldsResponse = metafieldsPaginated.map((m: any) => ({
          id: m.id,
          namespace: m.namespace,
          key: m.key,
          value: String(m.value)  // Convert to string
        }));

        logger.debug(`Found ${metafieldsResponse.length} metafields`);
        
      } catch (error) {
        logger.warn({ 
          orderId: order.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        }, "Failed to fetch metafield data from Shopify API");
      }

      const urlsMetafield = metafieldsResponse.find(
        (m: { namespace: string; key: string; value: string }) =>
          m.namespace === 'myoncare' && m.key === 'orderurls'
      );
      
      if (urlsMetafield?.value) {
        try {
          shortUrls = JSON.parse(urlsMetafield.value);
          logger.info({ orderName: order.name }, "Successfully retrieved order URLs from metafields");
        } catch (error) {
          logger.warn({ 
            metafieldValue: urlsMetafield.value,
            error: error instanceof Error ? error.message : 'Unknown error' 
          }, "Failed to parse orderurls JSON metafield");
        }
      } else {
        logger.info({ orderName: order.name }, "No orderurls metafield found for this order");
      }
    } catch (error) {
      logger.warn({ 
        orderId: order.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, "Failed to fetch metafield data from Shopify API");
    }
    return shortUrls;
}
async function getOrderLineItems(shopify: any, order: any, logger: any, legacyIdNum: number, shortUrls: { lineItemId: string; shortUrl: string }[]) {
    // Fetch line items directly from Shopify API
    let lineItems: OrderLineItem[] = [];
    try {
      const lineItemsResponse = await shopify.order.get(legacyIdNum, {
        fields: "line_items"
      });

      
      if (lineItemsResponse && lineItemsResponse.line_items) {
        lineItems = lineItemsResponse.line_items.map((item: any) => {
          const normalizedLineItemId = `gid://shopify/LineItem/${item.id}`;
          const shortUrlEntry = shortUrls.find(entry =>
            entry.lineItemId === normalizedLineItemId ||
            entry.lineItemId === String(item.id)
          );
          return {
            id: normalizedLineItemId,
            title: item.title,
            quantity: item.quantity,
            shortUrl: shortUrlEntry?.shortUrl || ''
          };
        });
        logger.info({ orderName: order.name, lineItemCount: lineItems.length }, "Successfully retrieved line items from Shopify API");
      }
    } catch (error) {
      logger.warn({ 
        orderId: order.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, "Failed to fetch line items from Shopify API, proceeding with empty line items");
    }
    return lineItems;
}
async function sendEmail(customerEmail: string, emailSubject: string, order: any, emailContent: string, logger: any) {
    const MAILGUN_DOMAIN = 'sandbox97416a562f9149aaa26171af37ddc698.mailgun.org';
    const mailgun = new Mailgun(formData);
    const mg = mailgun.client({
      username: 'api',
      key: process.env.MAILGUN_API_KEY!
    });

    // Send email through Mailgun
    logger.info({ 
      to: customerEmail, 
      subject: emailSubject,
      orderName: order.name,
      domain: MAILGUN_DOMAIN
    }, "Sending order email via Mailgun");

    let emailResult;
    try {
      emailResult = await mg.messages.create(MAILGUN_DOMAIN, {
        from: "MyOnCare <noreply@myoncare.com>",
        to: customerEmail,
        subject: emailSubject,
        html: emailContent
      });
    } catch (error) {
      // Handle Mailgun API errors
      const mailgunError = error as {
        message?: string;
        status?: number;
        details?: string;
        response?: {
          status?: number;
          data?: any;
        };
      };
      logger.error({ 
        error: mailgunError,
        status: mailgunError?.status || mailgunError?.response?.status,
        details: mailgunError?.details || mailgunError?.response?.data,
        orderName: order.name,
        customerEmail
      }, "Error from Mailgun API");
      
      throw new MailgunError(
        `Failed to send email: ${mailgunError?.message || 'Unknown error'}`, 
        mailgunError?.status || mailgunError?.response?.status, 
        mailgunError?.details || mailgunError?.response?.data
      );
    }

    // Validate Mailgun response
    if (!emailResult?.id || !emailResult?.message?.toLowerCase().includes("queued")) {
      throw new MailgunError("Unexpected response from Mailgun API", undefined, emailResult);
    }


    logger.info({ 
      messageId: emailResult.id, 
      orderName: order.name,
      customerEmail,
      status: emailResult.status
    }, "Email sent successfully");

    return emailResult;
}

const route: RouteHandler<{ Body: OrderEmailRequestBody }> = async ({request, reply, api, logger, connections}) => {
    logger.debug({ request }, "Received order email request");
  try {
    const { orderId, shopId, shopify } = await validateInputs(request, connections);
    const { legacyIdNum, order } = await getOrder(shopId, orderId, api, logger);
    const orderNumber = order.name || "Unknown Order";
    const orderDate = formatDate(order.processedAt || order.createdAt);
    const { customerEmail, customerName } = await getCustomerData(api, order, logger); 
    const shortUrls = await getOrderUrls(shopify, order, logger);
    const items = await getOrderLineItems(shopify, order, logger, legacyIdNum, shortUrls);
    const { subject: emailSubject, html: emailContent } = generateOrderEmailTemplate({orderNumber,orderDate,items,customerName,});
    const emailResult = await sendEmail(customerEmail, emailSubject, order, emailContent, logger);
    
    return await reply.send({
      success: true,
      message: `Order email sent to ${customerEmail}`,
      messageId: emailResult.id
    });
  } catch (error) {
    // Handle specific error types
    if (error instanceof ValidationError) {
      logger.warn({ error: error instanceof ValidationError ? error.message : "Unknown error",}, "Validation error in order email request");
      return await reply.code(400).send({
        success: false,
        errorType: "validation_error",
        error: error instanceof ValidationError ? error.message : "Unknown error",
      });
    }
    
    if (error instanceof AuthenticationError) {
      logger.error({ error: error instanceof AuthenticationError ? error.message : "Unknown error", }, "Authentication error in order email request");
      return await reply.code(403).send({
        success: false,
        errorType: "authentication_error",
        error: error instanceof AuthenticationError ? error.message : "Unknown error",
      });
    }
    
    if (error instanceof ShopifyError) {
      logger.error({ error: error instanceof ShopifyError ? error.message : "Unknown error", }, "Shopify error in order email request");
      return await reply.code(404).send({
        success: false,
        errorType: "shopify_error",
        error: error instanceof ShopifyError ? error.message : "Unknown error",
      });
    }
    
    if (error instanceof MailgunError) {
      logger.error({ 
        error: error instanceof MailgunError ? error.message : "Unknown error",
        statusCode: error instanceof MailgunError ? error.statusCode : "Unknown status code",
        details: error instanceof MailgunError ? error.details : "Unknown Error Details",
      }, "Mailgun error in order email request");
      return await reply.code(502).send({
        success: false,
        errorType: "mailgun_error",
        error: error instanceof MailgunError ? error.message : "Unknown error",
        statusCode: error instanceof MailgunError ? error.statusCode : "Unknown status code",
        details: error instanceof MailgunError ? error.details : "Unknown Error Details",
      });
    }
    
    if (error instanceof ConfigurationError) {
      logger.error({ error: error instanceof ConfigurationError ? error.message : "Unknown error" }, "Configuration error in order email request");
      return await reply.code(500).send({
        success: false,
        errorType: "configuration_error",
        error: error instanceof ConfigurationError ? error.message : "Unknown error"
      });
    }
    
    logger.error({ 
      error: error instanceof Error ? error.message : "Unknown error",
      errorType: error instanceof Error ? error.name : "Unknown error type",
      stack: error instanceof Error ? error.stack : undefined
    }, "Unhandled error processing order email request");
    
    return await reply.code(500).send({
      success: false,
      errorType: "server_error",
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
};
export default route;